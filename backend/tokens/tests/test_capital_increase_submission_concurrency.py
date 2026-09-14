import threading
import time
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings

from blockchain.tests.outgoing_fixtures import admitted_signer
from shared.api.exceptions import custom_exception_handler
from shared.db import current_alias, set_principal, use_operator
from shared.tests.scoped import aliases_this_deployment_has
from shared.tests.tenants import make_tenant
from tokens.exceptions import CapitalIncreaseConflict, InvalidTokenStateException
from tokens.models import CapitalIncreaseRequest, RequestStatus
from tokens.services import capital_execution
from tokens.services.capital_increase import submit_capital_increase
from tokens.services.dilution import dilution_for
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, CapitalNode, admit


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
@skipUnless(connection.vendor == "postgresql", "separate connections and row locks require PostgreSQL")
class CapitalIncreaseSubmissionConcurrencyTest(TransactionTestCase):
    databases = aliases_this_deployment_has()

    def setUp(self):
        with use_operator():
            self.tenant = make_tenant("submit-race")
            self.first = self.tenant.capital_increase
            self.second = CapitalIncreaseRequest.objects.create(
                token=self.tenant.deployed_token,
                additional_shares=50,
                new_authorized_total=int(self.tenant.deployed_token.total_supply) + 50,
                purpose="Another draft",
                board_resolution_reference="BOARD-RACE",
            )
            self.before = CapitalIncreaseRequest.objects.filter(pk=self.second.pk).values().get()
        set_principal(self.tenant.user.pk, current_alias())

    def _submit(self, pk):
        request = CapitalIncreaseRequest.objects.get(pk=pk)
        return submit_capital_increase(request, self.tenant.user)

    def _race(self, first_action, second_action, entered, release):
        results, pids = {}, {}
        started = threading.Event()

        def worker(name, action):
            try:
                set_principal(self.tenant.user.pk, current_alias())
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET statement_timeout = '10s'")
                    cursor.execute("SELECT pg_backend_pid()")
                    pids[name] = cursor.fetchone()[0]
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
        self.assertTrue(blocked, f"the competitor did not wait for the token lock: {results}")
        return results

    def _pause_dilution(self, entered, release):
        def calculate(request):
            if request.pk == self.first.pk:
                entered.set()
                if not release.wait(10):
                    raise AssertionError("the competing request never reached its lock")
            return dilution_for(request)

        return calculate

    def test_two_drafts_leave_the_loser_unchanged_with_the_normal_400_refusal(self):
        entered, release = threading.Event(), threading.Event()
        with patch("tokens.services.capital_increase.dilution_for", side_effect=self._pause_dilution(entered, release)):
            results = self._race(
                lambda: self._submit(self.first.pk), lambda: self._submit(self.second.pk), entered, release
            )
        self.assertIsInstance(results["first"], CapitalIncreaseRequest)
        loser = results["second"]
        self.assertIsInstance(loser, InvalidTokenStateException)
        response = custom_exception_handler(loser, {})
        self.assertEqual(response.status_code, 400)
        self.assertIn("ask the operator to reject it", str(response.data))
        self.first.refresh_from_db()
        self.assertIn(self.first.get_status_display(), str(response.data))
        self.assertIn(self.first.created_at.date().isoformat(), str(response.data))
        self.assertIn(self.tenant.deployed_token.symbol, str(response.data))
        self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=self.second.pk).values().get(), self.before)
        self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.first.token).in_flight().count(), 1)
        with self.assertRaises(InvalidTokenStateException) as sequential:
            self._submit(self.second.pk)
        self.assertEqual(loser.detail, sequential.exception.detail)

    def failed_command(self, request):
        with use_operator():
            actor = get_user_model().objects.create_superuser(email="capital-race@example.test", password="synthetic")
            admitted_signer()
            submit_capital_increase(request, self.tenant.user)
            request.approve(actor)
            node = CapitalNode()
            node.client.estimate_gas.side_effect = RuntimeError("Synthetic unsigned failure")
            with patch("tokens.services.capital_execution.get_base_chain_client", return_value=node.client):
                command = admit(request, actor)
                self.assertEqual(capital_execution.recover(command.pk)["status"], "failed")
            return actor, capital_execution.confirmation(request, actor)

    def retry(self, request, actor, form):
        with use_operator():
            return admit(request, actor, confirmed=form)

    def test_submit_winning_refuses_failed_retry_before_any_chain_work(self):
        actor, form = self.failed_command(self.second)
        entered, release = threading.Event(), threading.Event()
        with patch("tokens.services.capital_increase.dilution_for", side_effect=self._pause_dilution(entered, release)):
            with patch("tokens.services.capital_execution.get_base_chain_client") as provider:
                results = self._race(
                    lambda: self._submit(self.first.pk),
                    lambda: self.retry(self.second, actor, form),
                    entered,
                    release,
                )
        self.assertIsInstance(results["first"], CapitalIncreaseRequest)
        self.assertIsInstance(results["second"], CapitalIncreaseConflict)
        self.assertIn("another capital increase in flight", str(results["second"]))
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, RequestStatus.FAILED)
        provider.assert_not_called()

    def test_retry_admission_winning_refuses_draft_without_waiting_for_chain_execution(self):
        actor, form = self.failed_command(self.first)
        entered, release = threading.Event(), threading.Event()

        def committed_job(**kwargs):
            entered.set()
            if not release.wait(10):
                raise AssertionError("The competing submit never reached the admission lock")

        def retry():
            with use_operator(), patch("tokens.tasks.execute_review_request_task.defer", side_effect=committed_job):
                return capital_execution.admit(self.first, actor, confirmed=form)

        with patch("tokens.services.capital_execution.get_base_chain_client") as provider:
            results = self._race(retry, lambda: self._submit(self.second.pk), entered, release)
        self.assertIsInstance(results["second"], InvalidTokenStateException)
        self.first.refresh_from_db()
        self.assertEqual(self.first.status, RequestStatus.EXECUTING)
        self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=self.second.pk).values().get(), self.before)
        self.assertEqual(results["first"].request_id, self.first.pk)
        provider.assert_not_called()
