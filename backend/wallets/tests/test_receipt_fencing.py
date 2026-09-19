from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import Mock, patch

from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import acting_for, atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Transaction, Wallet
from wallets.tasks.confirmation import confirm_pending_transaction
from wallets.tests.test_wallet_finality import WalletFinalityFixture


class ReceiptFencingChecks(WalletFinalityFixture):
    def finish_while_receipt_changes(self, change):
        receipt = dict(self.observer.get_transaction_receipt.return_value)
        retained = []

        def read(tx_hash):
            change()
            retained.append(self.financial_state())
            return receipt

        self.observer.get_transaction_receipt.side_effect = read
        self.assertEqual(self.finish()["status"], "observation_changed")
        self.assertEqual(self.financial_state(), retained[0])
        self.notification.assert_not_called()
        self.assertEqual(self.balance_reads, [])

    def test_late_success_cannot_replace_a_newer_terminal_state(self):
        def change():
            with use_operator():
                Transaction.objects.filter(pk=self.tx_id).update(status="failed")

        self.finish_while_receipt_changes(change)

    def test_transaction_state_changed_during_receipt_read_is_not_settled(self):
        def change():
            with use_operator():
                Transaction.objects.filter(pk=self.tx_id).update(monitoring_completed_at=timezone.now())

        self.finish_while_receipt_changes(change)

    def test_journaled_wallet_address_cannot_change_and_the_original_can_still_settle(self):
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            Wallet.objects.filter(pk=self.wallet.pk).update(address=self.recipient)
        self.assertEqual(self.finish()["status"], "confirmed")

    def test_another_connection_can_commit_during_rpc_and_its_change_is_preserved(self):
        def update():
            try:
                with acting_for(self.tenant.user.pk):
                    Transaction.objects.filter(pk=self.tx_id).update(status="reorged")
            finally:
                connections.close_all()

        def change():
            with ThreadPoolExecutor(max_workers=1) as worker:
                worker.submit(update).result(timeout=15)

        self.finish_while_receipt_changes(change)

    def test_history_receipts_recheck_the_captured_row_and_accept_a_fresh_observation(self):
        with use_operator():
            tx = Transaction.objects.create(
                wallet=self.wallet,
                tx_hash="0x" + "71" * 32,
                chain=self.wallet.chain,
                from_address=self.recipient,
                to_address=self.wallet.address,
                asset=self.native,
                amount=Decimal("2"),
                imported_from_history=True,
            )
        provider = Mock(spec=["get_transaction_receipt"])
        receipt = {"transactionHash": tx.tx_hash, "status": 1, "blockNumber": 18}

        def change(tx_hash):
            with use_operator():
                Transaction.objects.filter(pk=tx.pk).update(amount=Decimal("3"))
            return receipt

        provider.get_transaction_receipt.side_effect = change
        before = self.financial_state()[1:]
        with patch("wallets.tasks.confirmation.get_blockchain_client", return_value=provider):
            self.assertEqual(
                confirm_pending_transaction.func(tx.tx_hash, str(self.wallet.pk), principal_id=self.tenant.user.pk)[
                    "status"
                ],
                "observation_changed",
            )
            with use_operator():
                tx.refresh_from_db()
            self.assertEqual(tx.status, "pending")
            provider.get_transaction_receipt.side_effect = None
            provider.get_transaction_receipt.return_value = receipt
            self.assertEqual(
                confirm_pending_transaction.func(tx.tx_hash, str(self.wallet.pk), principal_id=self.tenant.user.pk)[
                    "status"
                ],
                "confirmed",
            )
        self.assertEqual(self.financial_state()[1:], before)
        with use_operator():
            tx.refresh_from_db()
        self.assertEqual((tx.amount, tx.block_number), (Decimal("3"), 18))
        self.notification.assert_not_called()


class ReceiptFencingTest(ReceiptFencingChecks, APITransactionTestCase):
    pass


class ScopedReceiptFencingTest(RunsOnTheScopedConnection, ReceiptFencingChecks, APITransactionTestCase):
    pass
