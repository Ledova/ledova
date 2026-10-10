import threading
import time
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import Permission
from django.db import connection, connections
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from shared.api.exceptions import custom_exception_handler
from shared.db import current_alias, set_principal, use_operator
from shared.tests.scoped import SCOPED, aliases_this_deployment_has
from tokens.exceptions import CapitalIncreaseConflict
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RegisterCapitalIncrease,
    RequestStatus,
)
from tokens.services import capital_execution
from tokens.services.dilution import dilution_for
from tokens.services.register_capital_increases import prepare_capital_increase
from tokens.tests.company_capital_fixtures import CompanyCapitalCases


@skipUnless(connection.vendor == "postgresql", "separate connections and row locks require PostgreSQL")
class CapitalIncreaseSubmissionConcurrencyTest(CompanyCapitalCases, APITransactionTestCase):
    databases = aliases_this_deployment_has()

    def setUp(self):
        super().setUp()
        self.first = self.capital_payload()
        self.second = self.capital_payload(additional_shares=50, new_authorized_total=1050)
        with use_operator():
            self.owner.is_staff = True
            self.owner.save(update_fields=["is_staff"])
            self.owner.user_permissions.add(Permission.objects.get(codename="change_capitalincreaserequest"))

    def _submit(self, payload):
        return prepare_capital_increase(**payload)

    def _race(self, first_action, second_action, entered, release):
        results, pids, roles = {}, {}, {}
        started = threading.Event()

        def worker(name, action):
            try:
                with use_operator():
                    set_principal(self.owner.pk, current_alias())
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET statement_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        pids[name], roles[name] = cursor.fetchone()
                    if name == "second":
                        started.set()
                    results[name] = action()
            except Exception as exc:
                results[name] = exc
            finally:
                connections.close_all()

        first = threading.Thread(target=worker, args=("first", first_action))
        second = threading.Thread(target=worker, args=("second", second_action))
        first.start()
        blocked = False
        try:
            self.assertTrue(entered.wait(10), results)
            second.start()
            self.assertTrue(started.wait(10), results)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and "second" not in results:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", [pids["second"]])
                    row = cursor.fetchone()
                if row and row[0] == "Lock":
                    blocked = True
                    break
                time.sleep(0.01)
        finally:
            release.set()
            first.join(15)
            if second.ident is not None:
                second.join(15)
        self.assertFalse(first.is_alive() or second.is_alive(), results)
        self.assertNotEqual(pids["first"], pids["second"])
        if SCOPED:
            self.assertEqual(set(roles.values()), {settings.RLS_ROLES["operator"]})
        self.assertTrue(blocked, f"the competitor did not wait for the company command lock: {results}")
        return results

    def _pause_dilution(self, entered, release):
        def calculate(request):
            if request.additional_shares == 100:
                entered.set()
                if not release.wait(10):
                    raise AssertionError("the competing request never reached its lock")
            return dilution_for(request)

        return calculate

    def test_two_preparations_leave_one_original_with_the_normal_refusal(self):
        entered, release = threading.Event(), threading.Event()
        with patch(
            "tokens.services.dilution.dilution_for",
            side_effect=self._pause_dilution(entered, release),
        ):
            results = self._race(lambda: self._submit(self.first), lambda: self._submit(self.second), entered, release)
        self.assertIsInstance(results["first"], RegisterCapitalIncrease)
        loser = results["second"]
        self.assertIsInstance(loser, ValidationError)
        response = custom_exception_handler(loser, {})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(loser.detail, {"unmet_requirements": ["capital_in_flight"]})
        self.assertFalse(RegisterCapitalIncrease.objects.filter(pk=self.second["operation_id"]).exists())
        self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.token).in_flight().count(), 1)
        self.assertEqual(CapitalIncreaseRequest.objects.get(token=self.token).additional_shares, 100)
        with self.assertRaises(ValidationError) as sequential:
            self._submit(self.second)
        self.assertEqual(loser.detail, sequential.exception.detail)

    def failed_command(self, payload):
        proposal = self._submit(payload)
        self.capital_decide(proposal, "approve")
        self.capital_decide(proposal, "apply")
        request = proposal.request
        self.capital_node.client.estimate_gas.side_effect = RuntimeError("Synthetic unsigned preparation failure")
        with use_operator():
            command = CapitalIncreaseExecution.objects.get(request_id=request.pk)
            self.assertEqual(capital_execution.recover(command.pk)["status"], "failed")
            form = capital_execution.confirmation(request, self.owner)
        self.capital_node.client.estimate_gas.side_effect = None
        return request, form

    def retry(self, request, form):
        with use_operator():
            return capital_execution.admit(request, self.owner, confirmed=form)

    def test_preparation_winning_refuses_failed_retry_before_any_signing(self):
        request, form = self.failed_command(self.second)
        entered, release = threading.Event(), threading.Event()
        with patch(
            "tokens.services.dilution.dilution_for",
            side_effect=self._pause_dilution(entered, release),
        ):
            results = self._race(lambda: self._submit(self.first), lambda: self.retry(request, form), entered, release)
        self.assertIsInstance(results["first"], RegisterCapitalIncrease)
        self.assertIsInstance(results["second"], CapitalIncreaseConflict)
        self.assertIn("another capital increase in flight", str(results["second"]))
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.FAILED)
        self.assertFalse(CapitalIncreaseExecution.objects.get(request_id=request.pk).operation.current_attempt_id)
        self.assertFalse(self.capital_node.broadcasts)

    def test_retry_admission_winning_refuses_preparation_before_chain_execution(self):
        request, form = self.failed_command(self.first)
        entered, release = threading.Event(), threading.Event()

        def queued(execution):
            entered.set()
            if not release.wait(10):
                raise AssertionError("The competing preparation never reached the admission lock")

        def retry():
            with patch("tokens.services.capital_execution._enqueue", side_effect=queued):
                return self.retry(request, form)

        results = self._race(retry, lambda: self._submit(self.second), entered, release)
        self.assertIsInstance(results["first"], CapitalIncreaseExecution)
        self.assertIsInstance(results["second"], ValidationError)
        self.assertEqual(results["second"].detail, {"unmet_requirements": ["capital_in_flight"]})
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.EXECUTING)
        self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.token).in_flight().count(), 1)
        self.assertFalse(RegisterCapitalIncrease.objects.filter(pk=self.second["operation_id"]).exists())
        self.assertFalse(self.capital_node.broadcasts)
