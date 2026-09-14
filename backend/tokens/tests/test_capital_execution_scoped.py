import json
import threading
from unittest.mock import patch

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from blockchain.models import BlockchainTransaction, SignedAttempt
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest, ShareToken
from tokens.serializers.capital_increase import CapitalIncreaseUpdateSerializer
from tokens.services import capital_execution
from tokens.services.capital_increase import submit_capital_increase
from tokens.tasks import execute_review_request_task
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit, install_capital
from tokens.tests.test_review_request_admin import TEST_STORAGES
from tokens.views.capital_increase import CapitalIncreaseViewSet


@override_settings(STORAGES=TEST_STORAGES, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ScopedCapitalExecutionTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_capital(self)
        self.initial_jobs = set(self.queued())
        self.addCleanup(self.delete_new_jobs)

    def queued(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute("SELECT id, task_name, args FROM procrastinate_jobs ORDER BY id")
            return {
                row[0]: (row[1], row[2] if isinstance(row[2], dict) else json.loads(row[2]))
                for row in cursor.fetchall()
            }

    def delete_new_jobs(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            for identifier in set(self.queued()) - self.initial_jobs:
                cursor.execute("DELETE FROM procrastinate_jobs WHERE id=%s", [identifier])

    def test_issuer_and_staff_app_connections_cannot_read_or_admit_private_execution(self):
        with use_operator():
            command = admit(self.request, self.actor)
        for user in (self.tenant.user, self.actor):
            with acting_for(user.pk):
                for call in (
                    lambda: capital_execution.confirmation(self.request, self.actor),
                    lambda: capital_execution.recover(command.pk),
                ):
                    with self.assertRaises(PermissionDenied):
                        call()
                with self.assertRaises(DatabaseError), atomic():
                    CapitalIncreaseExecution.objects.filter(pk=command.pk).exists()
        self.node.client.send_raw_transaction.assert_not_called()

    def test_issuer_draft_edits_submission_and_deletion_never_query_the_private_journal(self):
        statements = []

        def observe(execute, sql, params, many, context):
            statements.append(sql)
            return execute(sql, params, many, context)

        with acting_for(self.tenant.user.pk), connections[APP_ALIAS].execute_wrapper(observe):
            draft = CapitalIncreaseRequest.objects.create(
                token=self.token,
                additional_shares=50,
                new_authorized_total=1050,
                purpose="Issuer draft",
                board_resolution_reference="ISSUER-BOARD",
            )
            draft.purpose = "Updated issuer draft"
            draft.save(update_fields=["purpose"])
            draft.delete()
            request = CapitalIncreaseRequest.objects.get(pk=self.request.pk)
            with self.assertRaises(DatabaseError), atomic():
                request.delete()
        self.assertFalse(any("tokens_capitalincreaseexecution" in sql.lower() for sql in statements))
        with use_operator():
            self.assertEqual(capital_execution.recover(admit(self.request, self.actor).pk)["status"], "executed")
        with acting_for(self.tenant.user.pk):
            draft = CapitalIncreaseRequest.objects.create(
                token=self.token,
                additional_shares=50,
                new_authorized_total=1050,
                purpose="Issuer submission",
                board_resolution_reference="SUBMIT-BOARD",
            )
            submit_capital_increase(draft, self.tenant.user)
            self.assertEqual(draft.status, "submitted")

    def test_public_cap_guard_refuses_issuer_mutation_and_preserves_pause_without_private_access(self):
        with use_operator():
            admit(self.request, self.actor)
        with acting_for(self.tenant.user.pk):
            for changes in ({"total_supply": "1500"}, {"contract_address": "0x" + "9" * 40}, {"decimals": 1}):
                with self.assertRaisesMessage(DatabaseError, "retains its identity and cap"), atomic():
                    ShareToken.objects.filter(pk=self.token.pk).update(**changes)
            self.assertEqual(ShareToken.objects.filter(pk=self.token.pk).update(status="paused"), 1)
        with use_operator():
            self.assertEqual(capital_execution.recover(self.request.dispatch_id)["status"], "executed")

    def test_admin_commits_command_request_and_exact_job_before_any_provider_call(self):
        with use_operator():
            self.client.force_login(self.actor)
        url = reverse("admin:tokens_capitalincreaserequest_execute", args=[self.request.pk])
        page = self.client.get(url)
        self.assertEqual(page.status_code, 200)
        payload = {"confirmation": page.context["form"]["confirmation"].value()}
        self.assertEqual(self.client.post(url, payload).status_code, 302)
        with use_operator():
            command = CapitalIncreaseExecution.objects.get()
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "executing")
            self.assertEqual(command.executed_by_id, self.actor.pk)
            jobs = self.queued()
            task, args = jobs[next(iter(set(jobs) - self.initial_jobs))]
            self.assertEqual(task, "tokens.tasks.review_request.execute_review_request_task")
            self.assertEqual(
                args,
                dict(
                    model_label=self.request._meta.label,
                    request_uuid=str(self.request.pk),
                    executed_by=self.actor.pk,
                    execution_id=str(command.pk),
                ),
            )
        self.node.client.assert_expected_chain.assert_not_called()
        self.assertEqual(self.client.post(url, payload).status_code, 302)
        self.assertEqual(len(set(self.queued()) - self.initial_jobs), 1)
        seen = []
        send = self.node.send

        def observed(raw):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                seen.append((current_alias(), cursor.fetchone()[0], connection.get_autocommit()))
            self.assertEqual(BlockchainTransaction.objects.get().tx_hash, SignedAttempt.objects.get().tx_hash)
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observed
        with acting_for(self.tenant.user.pk):
            self.assertTrue(execute_review_request_task.func(**args)["success"])
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.tenant.user.pk))
        self.assertEqual(seen, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True)])

    def test_admission_job_failure_rolls_back_public_hold_and_private_command_together(self):
        with use_operator():
            form = capital_execution.confirmation(self.request, self.actor)
            with patch(
                "tokens.tasks.execute_review_request_task.defer", side_effect=DatabaseError("Synthetic queue error")
            ):
                with self.assertRaises(DatabaseError):
                    capital_execution.admit(self.request, self.actor, confirmed=form)
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "approved")
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.assertEqual(set(self.queued()), self.initial_jobs)

    def test_stale_issuer_patch_and_delete_cannot_undo_submission_or_admission(self):
        for method in ("patch", "delete"):
            for admitted in (False, True):
                with self.subTest(method=method, admitted=admitted), use_operator():
                    tenant = make_tenant(f"stale-capital-{method}-{admitted}")
                    request = tenant.capital_increase
                    ready, release = threading.Event(), threading.Event()
                    results, pids = [], []
                    target = CapitalIncreaseUpdateSerializer if method == "patch" else CapitalIncreaseViewSet
                    name = "validate" if method == "patch" else "perform_destroy"
                    original = getattr(target, name)

                    def delayed(instance, value):
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT pg_backend_pid()")
                            pids.append(cursor.fetchone()[0])
                        result = original(instance, value) if method == "patch" else None
                        ready.set()
                        if not release.wait(10):
                            raise AssertionError("The competing transition did not commit")
                        return result if method == "patch" else original(instance, value)

                    def issuer():
                        try:
                            client = APIClient()
                            client.force_authenticate(tenant.user)
                            url = f"/api/v1/tokens/capital-increases/{request.pk}/"
                            action = getattr(client, method)
                            results.append(action(url, {"purpose": "Stale edit"}, format="json"))
                        except Exception as exc:
                            results.append(exc)
                        finally:
                            connections.close_all()

                    with patch.object(target, name, delayed):
                        worker = threading.Thread(target=issuer)
                        worker.start()
                        try:
                            self.assertTrue(ready.wait(10), results)
                            submit_capital_increase(request, tenant.user)
                            if admitted:
                                request.approve(self.actor)
                                command = admit(request, self.actor)
                                intent = command.intent
                            before = CapitalIncreaseRequest.objects.filter(pk=request.pk).values().get()
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                self.assertNotEqual(cursor.fetchone()[0], pids[0])
                        finally:
                            release.set()
                            worker.join(15)
                    self.assertFalse(worker.is_alive())
                    self.assertEqual(len(results), 1)
                    self.assertEqual(results[0].status_code, 503, results)
                    self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=request.pk).values().get(), before)
                    if admitted:
                        self.assertEqual(CapitalIncreaseExecution.objects.get(pk=command.pk).intent, intent)
        self.node.client.send_raw_transaction.assert_not_called()
