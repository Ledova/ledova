import json
import signal
import tempfile
from pathlib import Path
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.db import connection
from rest_framework.test import APITransactionTestCase

from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import SigningChallenge, SwapOrder, TransferOrder
from tokens.tests.order_process_fixtures import OrderChild, wait_for_row_lock
from tokens.tests.order_submission_fixtures import COUNTERPARTY, SubmissionFixtures

WORKER = "order_submission_worker"


class SubmissionProcessChecks(SubmissionFixtures):
    def crash(self, phase):
        counter = self.counter_order()
        signed = self.signed_body()
        with use_operator():
            original_swaps = SwapOrder.objects.count()
        with tempfile.TemporaryDirectory(prefix="order-submission-crash-") as temporary:
            directory = Path(temporary)
            child = OrderChild(self, WORKER, phase, directory, body=signed)
            self.assertEqual(child.wait(), -signal.SIGKILL, child.error_output())
            recovered = self.recover()
            self.assertEqual(recovered.status_code, 200, recovered.content)
            with use_operator():
                consumed = SigningChallenge.objects.get(digest=signed["digest"]).is_consumed
                counter.refresh_from_db()
                order_count = TransferOrder.objects.count()
                swap_count = SwapOrder.objects.count()
            if phase == "committed":
                self.assertEqual(recovered.json()["status"], "created")
                self.assertTrue(consumed)
                self.assertEqual(counter.filled_quantity, 10)
                self.assertEqual(order_count, self.initial_order_count + 1)
                self.assertEqual(swap_count, original_swaps + 1)
                events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
                self.assertEqual([event["event"] for event in events], ["order_created", "order_matched"])
                self.assertTrue(all(event["alias"] == "app" for event in events))
            else:
                self.assertEqual(recovered.json()["status"], "pending")
                self.assertFalse(consumed)
                self.assertEqual(counter.filled_quantity, 0)
                self.assertEqual(order_count, self.initial_order_count)
                self.assertEqual(swap_count, original_swaps)
                self.assertFalse((directory / "events.jsonl").exists())
            retry = self.create(signed)
            self.assertEqual(retry.status_code, 200 if phase == "committed" else 201, retry.content)
            with use_operator():
                self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 1)
                self.assertEqual(SwapOrder.objects.count(), original_swaps + 1)
                self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
            self.assertEqual(self.recover().json()["order"]["uuid"], retry.json()["order"]["uuid"])

    def test_process_death_after_spend_keeps_the_pending_submission_and_unspent_challenge(self):
        self.crash("spent")

    def test_process_death_after_matching_rolls_back_orders_swaps_and_reservations(self):
        self.crash("matched")

    def test_process_death_after_commit_recovers_the_original_match_once(self):
        self.crash("committed")

    def test_independent_app_requests_for_the_same_submission_serialize_and_recover_one_result(self):
        counter = self.counter_order()
        first = self.signed_body()
        second = self.signed_body()
        with use_operator():
            original_swaps = SwapOrder.objects.count()
        with tempfile.TemporaryDirectory(prefix="order-submission-retry-") as temporary:
            directory = Path(temporary)
            one = OrderChild(self, WORKER, "pause", directory, body=first)
            locked = one.read()
            self.assertEqual(locked["stage"], "locked")
            self.assertEqual(locked["database_user"], settings.RLS_ROLES["app"])
            two = OrderChild(self, WORKER, "compete", directory, body=second)
            selecting = two.read()
            self.assertEqual(selecting["stage"], "selecting")
            self.assertEqual(selecting["database_user"], settings.RLS_ROLES["app"])
            self.assertNotEqual(locked["pid"], selecting["pid"])
            wait_for_row_lock(self, selecting["pid"], "tokens_ordersubmission", locked["pid"])
            one.release()
            original = one.read()
            recovered = two.read()
            self.assertEqual((one.wait(), two.wait()), (0, 0))
            self.assertEqual((original["status"], recovered["status"]), (201, 200))
            self.assertEqual((original["alias"], recovered["alias"]), ("app", "app"))
            self.assertEqual(
                (original["database_user"], recovered["database_user"]),
                (settings.RLS_ROLES["app"], settings.RLS_ROLES["app"]),
            )
            self.assertEqual(original["body"], recovered["body"])
            events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
            self.assertEqual([event["event"] for event in events], ["order_created", "order_matched"])
        with use_operator():
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 1)
            self.assertEqual(SwapOrder.objects.count(), original_swaps + 1)
            counter.refresh_from_db()
            self.assertEqual(counter.filled_quantity, 10)
            self.assertTrue(SigningChallenge.objects.get(digest=first["digest"]).is_consumed)
            self.assertFalse(SigningChallenge.objects.get(digest=second["digest"]).is_consumed)

    def sell(self, quantity):
        return self.signed_body(self.body(submission_id=str(uuid4()), order_type="sell", quantity=quantity))

    def sell_quantities(self):
        with use_operator():
            return sorted(
                TransferOrder.objects.filter(wallet=self.wallet, order_type="sell").values_list("quantity", flat=True)
            )

    def concurrent_creates(self, first, second, table, statuses):
        with tempfile.TemporaryDirectory(prefix="order-submission-pair-") as temporary:
            directory = Path(temporary)
            one = OrderChild(self, WORKER, "matching", directory, body=first)
            matching = one.read()
            two = OrderChild(self, WORKER, "compete", directory, body=second)
            selecting = two.read()
            self.assertEqual((matching["stage"], selecting["stage"]), ("matching", "selecting"))
            self.assertNotEqual(matching["pid"], selecting["pid"])
            wait_for_row_lock(self, selecting["pid"], table, matching["pid"])
            one.release()
            results = (one.read(), two.read())
            self.assertEqual((one.wait(), two.wait()), (0, 0))
            self.assertEqual(
                tuple(result["status"] for result in results), statuses, one.error_output() + two.error_output()
            )
            self.assertEqual(
                {report["database_user"] for report in (matching, selecting, *results)}, {settings.RLS_ROLES["app"]}
            )
            return tuple(result["body"] for result in results)

    def test_a_second_sell_on_one_wallet_waits_and_is_refused_by_the_first_commitment(self):
        _, refused = self.concurrent_creates(self.sell(90), self.sell(90), "wallets", (201, 400))
        self.assertEqual((refused["status"], refused["refusal"]["code"]), ("refused", "insufficient_balance"))
        self.assertEqual(self.sell_quantities(), [90])

    def test_two_sells_that_fit_the_balance_together_both_open_after_waiting(self):
        self.concurrent_creates(self.sell(40), self.sell(40), "wallets", (201, 201))
        self.assertEqual(self.sell_quantities(), [40, 40])

    def test_crossing_creates_on_two_wallets_wait_on_the_account_and_match_once(self):
        resting = self.counter_order()
        with use_operator():
            original_swaps = SwapOrder.objects.count()
        buy = self.signed_body()
        sell = self.signed_body(
            self.body(
                submission_id=str(uuid4()),
                wallet_uuid=str(resting.wallet_id),
                wallet_address=resting.wallet_address,
                order_type="sell",
            ),
            signer=COUNTERPARTY,
        )
        matched, rested = self.concurrent_creates(buy, sell, "customer_accounts_account", (201, 201))
        self.assertEqual((matched["status"], rested["status"]), ("created", "created"))
        self.assertEqual(matched["match"]["counterOrder"], str(resting.pk))
        self.assertIsNone(rested["match"])
        with use_operator():
            self.assertEqual(SwapOrder.objects.count(), original_swaps + 1)
            resting.refresh_from_db()
            self.assertEqual(resting.filled_quantity, 10)


@skipUnless(connection.vendor == "postgresql", "Independent API requests require PostgreSQL transactions and roles")
class OrderSubmissionProcessTest(SubmissionProcessChecks, APITransactionTestCase):
    pass


class ScopedOrderSubmissionProcessTest(RunsOnTheScopedConnection, SubmissionProcessChecks, APITransactionTestCase):
    pass
