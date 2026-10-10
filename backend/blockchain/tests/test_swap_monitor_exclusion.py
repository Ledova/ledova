from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from uuid import uuid4

from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import BlockchainTransaction, TransactionStatus, TransactionType
from blockchain.services.transaction import check_pending_transactions
from shared.db import atomic, current_alias
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
            SwapOrder.objects.filter(pk=swap.pk).update(transaction_id=tx.pk)

    def snapshot(self):
        return (
            list(BlockchainTransaction.objects.order_by("pk").values()),
            list(SwapOrder.objects.order_by("pk").values()),
        )

    def test_receipt_finishes_while_another_connection_cannot_reclassify_or_claim_its_transaction(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid()")
            initial_pid = cursor.fetchone()[0]
        for outcome in (0, 1):
            for kind in ("type", "metadata", "reverse"):
                with self.subTest(outcome=outcome, kind=kind):
                    tx = self.transaction()
                    swap = make_swap(f"monitor-race-{outcome}-{kind}") if kind == "reverse" else None
                    before = self.snapshot()
                    observed = []

                    def associate_on_another_connection():
                        try:
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                backend_pid = cursor.fetchone()[0]
                            with atomic():
                                BlockchainTransaction.objects.select_for_update(nowait=True).get(pk=tx.pk)
                                if swap is not None:
                                    SwapOrder.objects.select_for_update(nowait=True).get(pk=swap.pk)
                                expected = (
                                    "Historical swap execution cannot be adopted or released"
                                    if kind == "reverse"
                                    else "Swap transaction identity, admission and arguments are immutable"
                                )
                                with self.assertRaisesMessage(DatabaseError, expected) as refused:
                                    with atomic():
                                        self.associate(tx, kind, swap)
                                self.assertEqual(refused.exception.__cause__.sqlstate, "P0001")
                            return backend_pid
                        finally:
                            connections.close_all()

                    with atomic():
                        BlockchainTransaction.objects.select_for_update().get(pk=tx.pk)
                        with ThreadPoolExecutor(max_workers=1) as executor:
                            with self.assertRaisesMessage(DatabaseError, "could not obtain lock") as locked:
                                executor.submit(associate_on_another_connection).result(timeout=15)
                        self.assertEqual(locked.exception.__cause__.sqlstate, "55P03")

                    def receipt(requested):
                        self.assertEqual(requested, tx.tx_hash)
                        with ThreadPoolExecutor(max_workers=1) as executor:
                            observed.append(executor.submit(associate_on_another_connection).result(timeout=15))
                        self.assertEqual(self.snapshot(), before)
                        return {**CONFIRMED, "status": outcome}

                    client = Mock(spec=["get_transaction_receipt"])
                    client.get_transaction_receipt.side_effect = receipt
                    self.assertEqual(
                        check_pending_transactions(client),
                        {"checked": 1, "confirmed": int(outcome == 1), "failed": int(outcome == 0)},
                    )
                    client.get_transaction_receipt.assert_called_once_with(tx.tx_hash)
                    self.assertEqual(len(observed), 1)
                    self.assertNotEqual(initial_pid, observed[0])
                    tx.refresh_from_db()
                    self.assertEqual(tx.status, TransactionStatus.CONFIRMED if outcome else TransactionStatus.REVERTED)
                    self.assertEqual(tx.tx_type, TransactionType.OTHER)
                    self.assertEqual((tx.related_model, tx.related_uuid, tx.outgoing_operation_id), (None, None, None))
                    after = self.snapshot()
                    self.assertEqual(
                        [row for row in after[0] if row["uuid"] != tx.pk],
                        [row for row in before[0] if row["uuid"] != tx.pk],
                    )
                    self.assertEqual(after[1], before[1])
