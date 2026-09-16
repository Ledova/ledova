from datetime import UTC, datetime
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TransactionTestCase, override_settings
from eth_account.messages import encode_typed_data

from blockchain.models import BlockchainTransaction
from shared.db import atomic
from tokens.models import SwapOrder, SwapOrderStatus, TransferOrder, TransferOrderStatus
from tokens.services.swap_expiry import expire_unclaimed_swap
from tokens.services.trading_locks import lock_orders
from tokens.tests import test_swap_process_concurrency as workers
from tokens.tests.swap_state_fixtures import CONTRACT, SELLER, sign_swap
from tokens.tests.test_swap_expiry import ExpiryFixtures


@skipUnless(connection.vendor == "postgresql", "Requires independent PostgreSQL row locks")
@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
class ExpiryProcessesRespectExecutionClaimsTest(ExpiryFixtures, TransactionTestCase):

    def setUp(self):
        super().setUp()
        self.now = datetime.now(UTC)
        self.clock.return_value = self.now

    def wait_for_row_lock(self, child, table, blocker_pid=None):
        workers.SwapWorkersUseOneCurrentClaimTest.wait_for_row_lock(self, child, table, blocker_pid)

    def completing_signature(self, swap):
        return (
            "0x"
            + SELLER.sign_message(encode_typed_data(full_message=self.service.get_typed_data(swap))).signature.hex()
        )

    def test_two_expiry_workers_wait_for_orders_and_release_once(self):
        swap = self.matched_swap(signed="both")
        cutoff = self.expired_at(swap).isoformat()
        first = workers.SwapProcess(self, "expire", swap.pk, cutoff)
        second = workers.SwapProcess(self, "expire", swap.pk, cutoff)
        with atomic():
            lock_orders(TransferOrder.objects.filter(pk__in=[swap.sell_order_id, swap.buy_order_id]))
            for worker, blocker in ((first, None), (second, first.database_pid)):
                worker.send("run")
                worker.receive("expiring")
                self.wait_for_row_lock(worker, "tokens_transferorder", blocker)
        outcomes = [first.done()["result"], second.done()["result"]]
        self.assertEqual(sorted(outcomes), [False, True])
        self.assert_available(swap, 20)

    def test_admission_wins_before_expiry_and_remains_reserved_before_any_send(self):
        swap = self.matched_swap(signed="buyer")
        expiry = workers.SwapProcess(self, "expire", swap.pk, self.expired_at(swap).isoformat())
        signature = self.completing_signature(swap)
        store = SwapOrder.add_seller_signature

        def admitted(order, value):
            expiry.send("run")
            expiry.receive("expiring")
            self.wait_for_row_lock(expiry, "tokens_transferorder")
            return store(order, value)

        with patch.object(SwapOrder, "add_seller_signature", admitted):
            self.assertEqual(sign_swap(swap, signature, SELLER.address).status, SwapOrderStatus.EXECUTING)
        self.assertFalse(expiry.done()["result"])
        current = SwapOrder.objects.get(pk=swap.pk)
        self.assertEqual(current.status, SwapOrderStatus.EXECUTING)
        self.assertIsNotNone(current.transaction_id)
        self.assertFalse(current.transaction.tx_hash)
        for order in (current.sell_order, current.buy_order):
            self.assertEqual(order.filled_quantity, 30)
            self.assertEqual(order.status, TransferOrderStatus.PENDING_SIGNATURE)

    def test_expiry_wins_and_a_late_admission_cannot_reclaim_the_released_orders(self):
        swap = self.matched_swap(signed="buyer")
        admission = workers.SwapProcess(self, "signature", swap.pk, "seller")
        admission.send("run")
        self.assertTrue(admission.receive("verified")["valid"])

        def released(*event):
            admission.send("store")
            self.wait_for_row_lock(admission, "tokens_transferorder")

        self.publisher.side_effect = released
        self.assertTrue(expire_unclaimed_swap(swap, self.expired_at(swap)))
        self.assertEqual(admission.refused(), "SwapNotReadyException")
        self.assert_available(swap, 20)
        current = SwapOrder.objects.get(pk=swap.pk)
        self.assertEqual((current.seller_signature, current.transaction_id), ("", None))
        self.assertFalse(BlockchainTransaction.objects.filter(related_uuid=swap.pk).exists())
