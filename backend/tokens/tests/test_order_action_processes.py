import json
import signal
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.db import connection, connections
from rest_framework.test import APITransactionTestCase

from operators.models import Operator
from shared.db import current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import OrderModificationLog, SigningChallenge
from tokens.tests.order_action_fixtures import BASE, ActionFixtures
from tokens.tests.order_process_fixtures import OrderChild, wait_for_row_lock
from wallets.models import Wallet

WORKER = "order_action_worker"


class ActionProcessChecks(ActionFixtures):
    def child(self, phase, directory, signed):
        return OrderChild(self, WORKER, phase, directory, body=signed, order_id=str(self.order.pk))

    def crash(self, phase):
        signed = self.signed("modify", self.modify_body())
        with tempfile.TemporaryDirectory(prefix="order-action-crash-") as temporary:
            directory = Path(temporary)
            child = self.child(phase, directory, signed)
            self.assertEqual(child.wait(), -signal.SIGKILL, child.error_output())
            recovered = self.recover()
            self.assertEqual(recovered.status_code, 200, recovered.content)
            with use_operator():
                consumed = SigningChallenge.objects.get(digest=signed["digest"]).is_consumed
                self.order.refresh_from_db()
                log_count = OrderModificationLog.objects.filter(order=self.order).count()
            if phase == "committed":
                self.assertEqual(recovered.json()["status"], "applied")
                self.assertTrue(consumed)
                self.assertEqual((self.order.quantity, self.order.modification_count, log_count), (12, 1, 3))
                events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
                self.assertEqual(events, [{"event": "order_modified", "alias": "app"}])
            else:
                self.assertEqual(recovered.json()["status"], "pending")
                self.assertFalse(consumed)
                self.assertEqual((self.order.quantity, self.order.modification_count, log_count), (10, 0, 0))
                self.assertFalse((directory / "events.jsonl").exists())
            retry = self.execute("modify", signed)
            self.assertEqual(retry.status_code, 200, retry.content)
            self.assertEqual(self.recover().json(), retry.json())
            with use_operator():
                self.order.refresh_from_db()
                self.assertEqual(self.order.modification_count, 1)
                self.assertEqual(OrderModificationLog.objects.filter(order=self.order).count(), 3)
                self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
            self.assertEqual(len(self.events), 0 if phase == "committed" else 1)

    def test_process_death_after_spend_leaves_a_pending_action_and_unspent_challenge(self):
        self.crash("spent")

    def test_process_death_after_modification_rolls_back_order_logs_and_spend(self):
        self.crash("applied")

    def test_process_death_after_commit_recovers_the_recorded_result_once(self):
        self.crash("committed")

    def test_independent_app_requests_for_one_action_serialize_and_recover_one_result(self):
        first = self.signed("modify", self.modify_body())
        second = self.signed("modify", self.modify_body())
        with tempfile.TemporaryDirectory(prefix="order-action-retry-") as temporary:
            directory = Path(temporary)
            one = self.child("pause", directory, first)
            locked = one.read()
            self.assertEqual(locked["stage"], "locked")
            self.assertEqual(locked["database_user"], settings.RLS_ROLES["app"])
            two = self.child("compete", directory, second)
            selecting = two.read()
            self.assertEqual(selecting["stage"], "selecting")
            self.assertEqual(selecting["database_user"], settings.RLS_ROLES["app"])
            self.assertNotEqual(locked["pid"], selecting["pid"])
            wait_for_row_lock(self, selecting["pid"], "tokens_orderactionsubmission", locked["pid"])
            one.release()
            original, recovered = one.read(), two.read()
            self.assertEqual((one.wait(), two.wait()), (0, 0))
            self.assertEqual((original["status"], recovered["status"]), (200, 200))
            self.assertEqual((original["alias"], recovered["alias"]), ("app", "app"))
            self.assertEqual(
                (original["database_user"], recovered["database_user"]),
                (settings.RLS_ROLES["app"], settings.RLS_ROLES["app"]),
            )
            self.assertEqual(original["body"], recovered["body"])
            events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
            self.assertEqual(events, [{"event": "order_modified", "alias": "app"}])
        with use_operator():
            self.order.refresh_from_db()
            self.assertEqual((self.order.quantity, self.order.modification_count), (12, 1))
            self.assertEqual(OrderModificationLog.objects.filter(order=self.order).count(), 3)
            self.assertTrue(SigningChallenge.objects.get(digest=first["digest"]).is_consumed)
            self.assertFalse(SigningChallenge.objects.get(digest=second["digest"]).is_consumed)

    def submission_message(self):
        return self.client.post(
            f"{BASE}create/message/",
            {
                "submission_id": str(uuid4()),
                "owner_account_uuid": str(self.tenant.account.pk),
                "token": str(self.tenant.deployed_token.pk),
                "wallet_uuid": str(self.wallet.pk),
                "wallet_address": self.wallet.address,
                "order_type": "buy",
                "quantity": 10,
                "min_quantity": 0,
                "price_per_share": "2.50",
            },
            format="json",
        )

    def test_a_verification_change_waits_for_the_modify_and_then_refuses_a_fresh_submission(self):
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="VERIFIED")
            Operator.get().supported_settlement_assets.set([self.tenant.refs.stablecoin])
        admitted = self.submission_message()
        self.assertEqual(admitted.status_code, 200, admitted.content)
        signed = self.signed("modify", self.modify_body())
        pids = {}
        connected = Event()

        def change_verification():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["writer"] = cursor.fetchone()[0]
                    connected.set()
                    return Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="PENDING")
            finally:
                connections.close_all()

        with tempfile.TemporaryDirectory(prefix="order-action-authorization-") as temporary, ThreadPoolExecutor(
            1
        ) as pool:
            child = self.child("pause", Path(temporary), signed)
            locked = child.read()
            self.assertEqual((locked["stage"], locked["database_user"]), ("locked", settings.RLS_ROLES["app"]))
            writing = pool.submit(change_verification)
            self.assertTrue(connected.wait(5), "The authorization writer did not connect")
            wait_for_row_lock(self, pids["writer"], "wallets", locked["pid"])
            child.release()
            applied = child.read()
            self.assertEqual(child.wait(), 0)
            self.assertEqual((applied["status"], applied["body"]["status"]), (200, "applied"), child.error_output())
            self.assertEqual(applied["database_user"], settings.RLS_ROLES["app"])
            self.assertEqual(writing.result(timeout=10), 1)
        denied = self.submission_message()
        self.assertEqual(denied.status_code, 400, denied.content)
        self.assertIn(b"verified EVM wallet", denied.content)
        with use_operator():
            self.order.refresh_from_db()
            self.assertEqual((self.order.quantity, self.order.modification_count), (12, 1))


@skipUnless(connection.vendor == "postgresql", "Independent action requests require PostgreSQL transactions and roles")
class OrderActionProcessTest(ActionProcessChecks, APITransactionTestCase):
    pass


class ScopedOrderActionProcessTest(RunsOnTheScopedConnection, ActionProcessChecks, APITransactionTestCase):
    pass
