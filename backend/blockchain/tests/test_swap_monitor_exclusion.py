from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, call
from uuid import uuid4

from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import BlockchainTransaction, TransactionStatus, TransactionType
from blockchain.services.transaction import check_pending_transactions
from shared.db import current_alias
from tokens.models import SwapOrder
from tokens.tests.swap_state_fixtures import CONFIRMED, CONTRACT, make_swap


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapMonitorExclusionTest(TransactionTestCase):
    def setUp(self):
        self.counter = 500

    def transaction(self):
        self.counter += 1
        return BlockchainTransaction.objects.create(
            tx_hash="0x" + f"{self.counter:064x}",
            status=TransactionStatus.SUBMITTED,
            from_address="0x" + "74" * 20,
        )

    def associate(self, tx, kind, swap):
        if kind == "type":
            BlockchainTransaction.objects.filter(pk=tx.pk).update(tx_type=TransactionType.ATOMIC_SWAP)
        elif kind == "metadata":
            BlockchainTransaction.objects.filter(pk=tx.pk).update(
                related_model="tokens.SwapOrder", related_uuid=uuid4()
            )
        else:
            SwapOrder.objects.filter(pk=swap.pk).update(transaction=tx)

    def snapshot(self):
        return (
            list(BlockchainTransaction.objects.order_by("pk").values()),
            list(SwapOrder.objects.order_by("pk").values()),
        )

    def test_each_swap_association_is_excluded_while_unrelated_transactions_still_finish(self):
        for outcome in (0, 1):
            with self.subTest(outcome=outcome):
                for kind in ("type", "metadata", "reverse"):
                    tx = self.transaction()
                    swap = make_swap(f"monitor-{outcome}-{kind}") if kind == "reverse" else None
                    self.associate(tx, kind, swap)
                before = self.snapshot()
                unrelated = self.transaction()
                client = Mock(spec=["get_transaction_receipt"])
                client.get_transaction_receipt.return_value = {**CONFIRMED, "status": outcome}
                self.assertEqual(
                    check_pending_transactions(client),
                    {"checked": 1, "confirmed": int(outcome == 1), "failed": int(outcome == 0)},
                )
                self.assertEqual(client.get_transaction_receipt.call_args_list, [call(unrelated.tx_hash)])
                unrelated.refresh_from_db()
                self.assertEqual(
                    unrelated.status, TransactionStatus.CONFIRMED if outcome else TransactionStatus.REVERTED
                )
                after = self.snapshot()
                self.assertEqual([row for row in after[0] if row["uuid"] != unrelated.pk], before[0])
                self.assertEqual(after[1], before[1])

    def test_receipt_cannot_cross_a_swap_association_committed_on_another_connection(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid()")
            initial_pid = cursor.fetchone()[0]
        for outcome in (0, 1):
            for kind in ("type", "metadata", "reverse"):
                with self.subTest(outcome=outcome, kind=kind):
                    tx = self.transaction()
                    swap = make_swap(f"monitor-race-{outcome}-{kind}") if kind == "reverse" else None
                    observed = []
                    backend_pids = []

                    def associate_on_another_connection():
                        try:
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                backend_pids.append(cursor.fetchone()[0])
                            self.associate(tx, kind, swap)
                        finally:
                            connections.close_all()

                    def receipt(requested):
                        self.assertEqual(requested, tx.tx_hash)
                        with ThreadPoolExecutor(max_workers=1) as executor:
                            executor.submit(associate_on_another_connection).result(timeout=15)
                        observed.append(self.snapshot())
                        return {**CONFIRMED, "status": outcome}

                    client = Mock(spec=["get_transaction_receipt"])
                    client.get_transaction_receipt.side_effect = receipt
                    self.assertEqual(check_pending_transactions(client), {"checked": 1, "confirmed": 0, "failed": 0})
                    client.get_transaction_receipt.assert_called_once_with(tx.tx_hash)
                    self.assertEqual(len(observed), 1)
                    self.assertEqual(self.snapshot(), observed[0])
                    self.assertEqual(len(backend_pids), 1)
                    self.assertNotEqual(initial_pid, backend_pids[0])
