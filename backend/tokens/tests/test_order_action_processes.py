import json
import signal
import tempfile
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from threading import Event
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.db import connection, connections
from rest_framework.test import APITransactionTestCase

from operators.models import Operator
from operators.settlement import require_deployment
from shared.db import current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.utils.token_amounts import token_base_units_ceiling
from shared.utils.typed_data import signable_message
from tokens.models import (
    OrderModificationLog,
    SigningChallenge,
    SwapOrder,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.tests.order_action_fixtures import BASE, OTHER_KEY, ActionFixtures
from tokens.tests.order_process_fixtures import OrderChild, wait_for_row_lock
from wallets.models import Wallet

WORKER = "order_action_worker"


class ActionProcessChecks(ActionFixtures):
    def child(self, phase, directory, signed, *, order=None, endpoint="modify", **options):
        return OrderChild(
            self,
            WORKER,
            phase,
            directory,
            body=signed,
            order_id=str((order or self.order).pk),
            endpoint=endpoint,
            **options,
        )

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

    def assert_competing_raises_share_the_current_balance(self, order_type, quantity, increased):
        self.payment_balance = 6000
        with use_operator():
            self.order.order_type = order_type
            self.order.quantity = quantity
            self.order.save(update_fields=["order_type", "quantity"])
            other = TransferOrder.objects.create(
                token=self.order.token,
                payment_asset=self.order.payment_asset,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type=order_type,
                quantity=quantity,
                price_per_share=Decimal("2.50"),
            )
        intent = self.modify_body(new_quantity=str(increased), new_price_per_share="2.50")
        first = self.signed("modify", intent)
        second = self.signed("modify", {**intent, "action_id": str(uuid4())}, order=other)
        with tempfile.TemporaryDirectory(prefix="order-action-budget-") as temporary:
            directory = Path(temporary)
            one = self.child("preflight", directory, first, payment_balance=self.payment_balance)
            first_read = one.read()
            two = self.child("preflight", directory, second, order=other, payment_balance=self.payment_balance)
            second_read = two.read()
            for read in (first_read, second_read):
                self.assertEqual((read["stage"], read["database_user"]), ("preflight", settings.RLS_ROLES["app"]))
            self.assertNotEqual(first_read["pid"], second_read["pid"])
            one.release()
            accepted = one.read()
            self.assertEqual(one.wait(), 0, one.error_output())
            two.release()
            refused = two.read()
            self.assertEqual(two.wait(), 0, two.error_output())
        self.assertEqual((accepted["status"], accepted["body"]["status"]), (200, "applied"), accepted)
        self.assertEqual((refused["status"], refused["body"]["status"]), (400, "refused"), refused)
        self.assertEqual(refused["body"]["refusal"]["code"], "order_modification_failed")
        with use_operator():
            self.order.refresh_from_db()
            other.refresh_from_db()
            self.assertEqual((self.order.quantity, other.quantity), (increased, quantity))
            self.assertEqual((self.order.modification_count, other.modification_count), (1, 0))
            self.assertEqual(
                SigningChallenge.objects.filter(
                    digest__in=[first["digest"], second["digest"]], consumed_at__isnull=False
                ).count(),
                2,
            )
            if order_type == "sell":
                committed = TransferOrder.objects.committed_sell_quantity(self.order.token, self.wallet.address)
                self.assertEqual(committed, 100)
            else:
                decimals = require_deployment(self.order.payment_asset).decimals
                committed = TransferOrder.objects.committed_buy_payment(
                    self.order.payment_asset, self.wallet.address, decimals
                )
                self.assertEqual(committed, self.payment_balance)
        retry = self.execute("modify", second, order=other)
        self.assertEqual(retry.status_code, 400, retry.content)
        self.assertEqual(retry.json(), refused["body"])
        self.assertEqual(self.recover(action_id=second["action_id"]).json(), refused["body"])

    def test_competing_buy_raises_use_commitments_current_at_the_decision_lock(self):
        self.assert_competing_raises_share_the_current_balance("buy", 10, 14)

    def test_competing_sell_raises_use_commitments_current_at_the_decision_lock(self):
        self.assert_competing_raises_share_the_current_balance("sell", 40, 60)

    def match_pair_setup(self):
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="VERIFIED")
            Operator.get().supported_settlement_assets.set([self.tenant.refs.stablecoin])
            TransferOrder.objects.filter(token=self.tenant.deployed_token).update(status=TransferOrderStatus.CANCELLED)
            self.counterparty = Wallet.objects.create(
                user_account=self.tenant.account,
                address=OTHER_KEY.address,
                chain="base",
                verification_status="VERIFIED",
            )
            self.candidate = TransferOrder.objects.create(
                token=self.tenant.deployed_token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type="sell",
                quantity=10,
                min_quantity=0,
                price_per_share=Decimal("2.50"),
            )

    def signed_create(self, price):
        body = {
            "submission_id": str(uuid4()),
            "owner_account_uuid": str(self.tenant.account.pk),
            "token": str(self.tenant.deployed_token.pk),
            "wallet_uuid": str(self.counterparty.pk),
            "wallet_address": self.counterparty.address,
            "order_type": "buy",
            "quantity": 10,
            "min_quantity": 0,
            "price_per_share": price,
        }
        response = self.client.post(f"{BASE}create/message/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        challenge = response.json()["challenge"]
        return {
            **body,
            "digest": challenge["digest"],
            "signature": OTHER_KEY.sign_message(
                signable_message(challenge["domain"], challenge["types"], challenge["message"])
            ).signature.to_0x_hex(),
        }

    def test_a_modify_waits_for_the_match_and_is_then_refused_on_the_matched_order(self):
        self.match_pair_setup()
        signed = self.signed("modify", self.modify_body(), order=self.candidate)
        create = self.signed_create("2.50")
        with tempfile.TemporaryDirectory(prefix="order-action-match-") as temporary:
            directory = Path(temporary)
            matcher = OrderChild(self, "order_submission_worker", "candidates", directory, body=create)
            locked = matcher.read()
            self.assertEqual(locked["stage"], "candidates-locked")
            action = self.child("compete", directory, signed, order=self.candidate)
            selecting = action.read()
            self.assertEqual(selecting["stage"], "selecting")
            wait_for_row_lock(self, selecting["pid"], "customer_accounts_account", locked["pid"])
            matcher.release()
            matched, refused = matcher.read(), action.read()
            self.assertEqual((matcher.wait(), action.wait()), (0, 0), (matcher.error_output(), action.error_output()))
        self.assertEqual(matched["status"], 201, matched)
        self.assertIsNotNone(matched["body"]["match"])
        self.assertEqual(refused["status"], 409, refused)
        self.assertEqual(refused["body"]["status"], "refused")
        self.assertEqual(refused["body"]["refusal"]["code"], "order_modification_conflict")
        with use_operator():
            self.candidate.refresh_from_db()
            swap = SwapOrder.objects.get(pk=matched["body"]["match"]["swapOrder"])
            self.assertEqual(
                (self.candidate.status, self.candidate.modification_count, self.candidate.filled_quantity),
                ("pending_signature", 0, 10),
            )
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, 2500))
        recorded = self.recover(action_id=signed["action_id"]).json()
        self.assertEqual(recorded["status"], "refused")

    def test_a_cancellation_waits_for_the_match_and_is_then_refused_on_the_matched_order(self):
        self.match_pair_setup()
        signed = self.signed("cancel", self.identity(), order=self.candidate)
        create = self.signed_create("2.50")
        with tempfile.TemporaryDirectory(prefix="order-action-match-") as temporary:
            directory = Path(temporary)
            matcher = OrderChild(self, "order_submission_worker", "candidates", directory, body=create)
            locked = matcher.read()
            self.assertEqual(locked["stage"], "candidates-locked")
            action = self.child("compete", directory, signed, order=self.candidate, endpoint="cancel")
            selecting = action.read()
            self.assertEqual(selecting["stage"], "selecting")
            wait_for_row_lock(self, selecting["pid"], "customer_accounts_account", locked["pid"])
            matcher.release()
            matched, refused = matcher.read(), action.read()
            self.assertEqual((matcher.wait(), action.wait()), (0, 0), (matcher.error_output(), action.error_output()))
        self.assertEqual(matched["status"], 201, matched)
        self.assertEqual(refused["status"], 400, refused)
        self.assertEqual(refused["body"]["status"], "refused")
        self.assertEqual(refused["body"]["refusal"]["code"], "order_cancellation_failed")
        with use_operator():
            self.candidate.refresh_from_db()
            self.assertEqual((self.candidate.status, self.candidate.filled_quantity), ("pending_signature", 10))
            self.assertTrue(SwapOrder.objects.filter(pk=matched["body"]["match"]["swapOrder"]).exists())

    def test_a_match_waits_for_a_modification_and_matches_the_modified_values(self):
        self.match_pair_setup()
        signed = self.signed(
            "modify", self.modify_body(new_quantity="12", new_price_per_share="3.00"), order=self.candidate
        )
        create = self.signed_create("3.00")
        with tempfile.TemporaryDirectory(prefix="order-action-match-") as temporary:
            directory = Path(temporary)
            action = self.child("order-locked", directory, signed, order=self.candidate)
            holding = action.read()
            self.assertEqual(holding["stage"], "order-locked")
            matcher = OrderChild(self, "order_submission_worker", "compete", directory, body=create)
            matching = matcher.read()
            self.assertEqual(matching["stage"], "selecting")
            wait_for_row_lock(self, matching["pid"], "customer_accounts_account", holding["pid"])
            action.release()
            applied, matched = action.read(), matcher.read()
            self.assertEqual((action.wait(), matcher.wait()), (0, 0), (action.error_output(), matcher.error_output()))
        self.assertEqual(applied["status"], 200, applied)
        self.assertEqual(applied["body"]["status"], "applied")
        self.assertEqual(matched["status"], 201, matched)
        expected_payment = token_base_units_ceiling(
            Decimal(10) * Decimal("3.00"), require_deployment(self.tenant.refs.stablecoin).decimals
        )
        with use_operator():
            self.candidate.refresh_from_db()
            swap = SwapOrder.objects.get(pk=matched["body"]["match"]["swapOrder"])
            self.assertEqual(
                (self.candidate.quantity, self.candidate.modification_count, self.candidate.filled_quantity),
                (12, 1, 10),
            )
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, expected_payment))

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
