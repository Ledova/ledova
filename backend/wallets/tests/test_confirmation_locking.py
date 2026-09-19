import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.db import OperationalError, connections
from rest_framework.test import APITransactionTestCase

from shared.db import acting_for, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Holding, Transaction
from wallets.services import transaction_confirmation
from wallets.services.chain_observations import observe_wallet_chain
from wallets.services.holdings import sync_holding
from wallets.services.sync import _process_transactions
from wallets.tests.test_wallet_finality import WalletFinalityFixture


class ConfirmationChecks(WalletFinalityFixture):
    def separate_connection(self, action):
        def run():
            try:
                return action()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as worker:
            return worker.submit(run).result(timeout=15)

    def test_balance_read_discards_a_submission_committed_while_the_provider_was_answering(self):
        before = self.quantity()

        def submit(wallet, asset):
            self.separate_connection(self.second_submission)
            return Decimal("10")

        with acting_for(self.tenant.user.pk), patch(
            "wallets.services.holdings.fetch_chain_balance", side_effect=submit
        ):
            self.assertIsNone(sync_holding(self.wallet, self.native))
        self.assertEqual(self.quantity(), before - Decimal("1.000042"))

    def test_a_holding_created_during_a_balance_read_cannot_be_overwritten(self):
        with use_operator():
            Holding.objects.filter(pk=self.holding.pk).delete()

        def submit(wallet, asset):
            self.separate_connection(self.second_submission)
            return Decimal("10")

        with acting_for(self.tenant.user.pk), patch(
            "wallets.services.holdings.fetch_chain_balance", side_effect=submit
        ):
            self.assertIsNone(sync_holding(self.wallet, self.native))
        with use_operator():
            self.assertEqual(Holding.objects.get(wallet=self.wallet, asset=self.native).quantity, Decimal("0"))

    def test_duplicate_consumers_commit_one_outcome_and_notification(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        gate = Barrier(2)

        def settle():
            try:
                gate.wait(timeout=10)
                return self.settle()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as workers:
            futures = [workers.submit(settle) for _ in range(2)]
            results = [future.result(timeout=15)["status"] for future in futures]
        self.assertEqual(sorted(results), ["already_processed", "confirmed"])
        self.notification.assert_called_once()
        self.assertEqual(self.quantity(), Decimal("7.999958"))

    def test_a_new_debit_after_balance_reads_keeps_the_repair_token(self):
        self.finish()
        self.balance = Decimal("7.999979")
        verify = transaction_confirmation._verify_holding_balance

        def concurrent(wallet, asset):
            holdings = verify(wallet, asset)
            self.separate_connection(self.second_submission)
            return holdings

        with patch.object(transaction_confirmation, "_verify_holding_balance", side_effect=concurrent):
            self.assertFalse(self.repair())
        with use_operator():
            self.assertIsNotNone(Transaction.objects.get(pk=self.tx_id).balance_reconciliation_token)
        self.assertEqual(self.quantity(), Decimal("6.999937"))

    def test_an_older_repair_cannot_clear_a_replacement_repair_token(self):
        self.finish()
        self.balance = Decimal("7.999979")
        verify = transaction_confirmation._verify_holding_balance
        changed = uuid4()

        def concurrent(wallet, asset):
            holdings = verify(wallet, asset)

            def replace():
                with use_operator():
                    Transaction.objects.filter(pk=self.tx_id).update(balance_reconciliation_token=changed)

            self.separate_connection(replace)
            return holdings

        with patch.object(transaction_confirmation, "_verify_holding_balance", side_effect=concurrent):
            self.assertFalse(self.repair())
        self.assertEqual(self.transactions()[0]["balance_reconciliation_token"], changed)
        self.assertTrue(self.repair())

    def test_failure_after_status_commit_keeps_balance_repair_durable(self):
        for boundary in ("_verify_holding_balance", "_update_snapshot_on_confirmation"):
            with self.subTest(boundary=boundary):
                self.balance = Decimal("7.999979")
                with patch.object(
                    transaction_confirmation, boundary, side_effect=RuntimeError("Synthetic interruption")
                ):
                    with self.assertRaisesRegex(RuntimeError, "Synthetic interruption"):
                        self.finish()
                self.assertEqual(self.transactions()[0]["status"], "confirmed")
                self.assertIsNotNone(self.transactions()[0]["balance_reconciliation_token"])
        self.assertEqual(self.finish()["status"], "reconciled")
        self.notification.assert_called_once()
        self.assertIsNone(self.transactions()[0]["balance_reconciliation_token"])

    def test_history_waits_on_the_same_wallet_lock_before_preserving_a_finalized_transfer(self):
        observed = []

        def notify(**kwargs):
            connection = connections[current_alias()]

            def attempt():
                with acting_for(self.tenant.user.pk):
                    alias = current_alias()
                    with connections[alias].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '200ms'")
                    with self.assertRaises(OperationalError) as error:
                        _process_transactions(
                            self.wallet, [{"tx_hash": self.signed_transfer.hash.to_0x_hex(), "amount": "900"}]
                        )
                    observed.append(str(error.exception))

            self.separate_connection(attempt)
            self.assertTrue(connection.in_atomic_block)

        self.notification.side_effect = notify
        self.assertEqual(self.finish()["status"], "confirmed")
        self.assertIn("lock timeout", observed[0])
        with acting_for(self.tenant.user.pk):
            self.assertEqual(
                _process_transactions(
                    self.wallet, [{"tx_hash": self.signed_transfer.hash.to_0x_hex(), "amount": "900"}]
                ),
                {"status": "success", "transactions": 0, "snapshots": 0},
            )
        self.assertEqual(self.transactions()[0]["amount"], Decimal("2"))

    @skipUnless(hasattr(os, "fork"), "Process recovery requires fork")
    def test_process_exit_after_observation_or_settlement_keeps_recovery_durable(self):
        for boundary in ("observation", "settlement"):
            connections.close_all()
            child = os.fork()
            if child == 0:
                try:
                    if boundary == "observation":
                        observe_wallet_chain(self.tx_id)
                    else:
                        self.settle()
                    os._exit(23)
                finally:
                    os._exit(24)
            exited = False
            try:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    reaped, status = os.waitpid(child, os.WNOHANG)
                    if reaped:
                        exited = True
                        self.assertEqual(os.waitstatus_to_exitcode(status), 23)
                        break
                    time.sleep(0.01)
                self.assertTrue(exited)
            finally:
                if not exited:
                    os.kill(child, signal.SIGKILL)
                    os.waitpid(child, 0)
        self.assertEqual(self.transactions()[0]["status"], "confirmed")
        self.assertIsNotNone(self.transactions()[0]["balance_reconciliation_token"])
        self.balance = Decimal("7.999979")
        self.assertEqual(self.finish()["status"], "reconciled")
        self.assertEqual(self.quantity(), self.balance)
        self.notification.assert_not_called()


class ConfirmationLockingTest(ConfirmationChecks, APITransactionTestCase):
    pass


class ScopedConfirmationLockingTest(RunsOnTheScopedConnection, ConfirmationChecks, APITransactionTestCase):
    pass
