import json
from unittest.mock import patch

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied

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
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest, ShareToken
from tokens.services import capital_execution
from tokens.tasks import execute_review_request_task
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit, install_capital
from tokens.tests.test_review_request_admin import TEST_STORAGES


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

    def test_retired_customer_draft_writes_and_current_request_edits_never_query_the_private_journal(self):
        statements = []

        def observe(execute, sql, params, many, context):
            statements.append(sql)
            return execute(sql, params, many, context)

        with acting_for(self.tenant.user.pk), connections[APP_ALIAS].execute_wrapper(observe):
            with self.assertRaises(DatabaseError), atomic():
                CapitalIncreaseRequest.objects.create(
                    token=self.token,
                    additional_shares=50,
                    new_authorized_total=1050,
                    purpose="Retired owner draft",
                    board_resolution_reference="ISSUER-BOARD",
                )
            request = CapitalIncreaseRequest.objects.get(pk=self.request.pk)
            before = request.purpose
            with self.assertRaises(DatabaseError), atomic():
                CapitalIncreaseRequest.objects.filter(pk=request.pk).update(purpose="Raw owner edit")
            with connections[APP_ALIAS].cursor() as cursor:
                cursor.execute("DELETE FROM tokens_capitalincreaserequest WHERE uuid=%s", [request.pk])
                self.assertEqual(cursor.rowcount, 0)
            request.refresh_from_db()
            self.assertEqual(request.purpose, before)
        self.assertFalse(any("tokens_capitalincreaseexecution" in sql.lower() for sql in statements))
        with use_operator():
            self.assertEqual(capital_execution.recover(admit(self.request, self.actor).pk)["status"], "executed")

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

    def test_company_apply_commits_original_request_and_exact_active_alias_job_before_signing(self):
        with patch("tokens.services.capital_execution._enqueue", self.company_capital.enqueue):
            self.company_capital.capital_decide(self.proposal, "apply")
        with use_operator():
            self.client.force_login(self.actor)
            command = CapitalIncreaseExecution.objects.get(request_id=self.request.pk)
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
        self.node.client.send_raw_transaction.assert_not_called()
        url = reverse("admin:tokens_capitalincreaserequest_execute", args=[self.request.pk])
        page = self.client.get(url)
        self.assertEqual(page.status_code, 200)
        payload = {"confirmation": page.context["form"]["confirmation"].value()}
        self.assertEqual(self.client.post(url, payload).status_code, 302)
        self.assertEqual(self.client.post(url, payload).status_code, 302)
        self.assertEqual(len(set(self.queued()) - self.initial_jobs), 1)
        seen = []
        send = self.node.send

        def observed(raw):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                seen.append((current_alias(), cursor.fetchone()[0], connection.get_autocommit()))
            self.assertEqual(self.transactions.get().tx_hash, self.attempts.get().tx_hash)
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observed
        with acting_for(self.tenant.user.pk):
            self.assertTrue(execute_review_request_task.func(**args)["success"])
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.tenant.user.pk))
        self.assertEqual(seen, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True)])

    def test_admission_job_failure_rolls_back_the_exact_company_outcome_and_original_hold(self):
        with patch("tokens.services.capital_execution._enqueue", side_effect=DatabaseError("Synthetic queue error")):
            with self.assertRaises(DatabaseError):
                self.company_capital.capital_decide(self.proposal, "apply")
        with use_operator():
            self.request.refresh_from_db()
            self.proposal.refresh_from_db()
            self.assertEqual(self.request.status, "under_review")
            self.assertEqual(self.proposal.status, "submitted")
            self.assertEqual(list(self.proposal.decisions.values_list("kind", flat=True)), ["approve"])
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.assertEqual(set(self.queued()), self.initial_jobs)
