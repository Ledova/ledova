import inspect
from datetime import timedelta
from unittest.mock import patch

from django.db import IntegrityError
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.models import BlockchainTransaction
from shared.tests.settlement import save_swap_with_context
from shared.tests.tenants import make_tenant
from tokens.models import SwapOrder, TransferOrder
from tokens.models.choices import SwapOrderStatus, TransferOrderStatus
from tokens.services import atomic_swap_service, swap_execution
from tokens.tasks.swap_reconciler import resolve_executing_swaps
from tokens.tests.swap_execution_fixtures import make_execution
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
class TheSweepFindsOnlyStuckSwapsTest(TransactionTestCase):
    def setUp(self):
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        self.record = self.admit("sweep-first")

    def admit(self, label):
        fixture = make_execution(label)
        for participant, key in (("seller", SELLER), ("buyer", BUYER)):
            swap = swap_execution.submit_signature(
                fixture.swap,
                fixture.signatures[participant],
                key.address,
                user=getattr(fixture, participant).user,
                participant=participant,
            )
        return swap.transaction

    def age(self, record, minutes):
        BlockchainTransaction.objects.filter(pk=record.pk).update(
            updated_at=timezone.now() - timedelta(minutes=minutes)
        )

    def test_a_stale_admitted_transaction_is_recovered_by_its_original_uuid(self):
        self.age(self.record, 20)
        with patch("tokens.tasks.swap_reconciler.swap_execution.recover", return_value="confirmed") as recover:
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 1})
        recover.assert_called_once_with(self.record.pk)

    def test_a_recent_admission_is_left_for_its_durable_job(self):
        with patch("tokens.tasks.swap_reconciler.swap_execution.recover") as recover:
            self.assertEqual(resolve_executing_swaps(), {"checked": 0, "resolved": 0})
        recover.assert_not_called()

    def test_one_unreachable_transaction_does_not_stop_the_next(self):
        other = self.admit("sweep-second")
        self.age(self.record, 30)
        self.age(other, 20)
        with patch(
            "tokens.tasks.swap_reconciler.swap_execution.recover", side_effect=[RuntimeError(), "reverted"]
        ) as recover:
            self.assertEqual(resolve_executing_swaps(), {"checked": 2, "resolved": 1})
        self.assertEqual([call.args[0] for call in recover.call_args_list], [self.record.pk, other.pk])

    def test_the_batch_is_bounded_and_starts_with_the_oldest_transaction(self):
        other = self.admit("sweep-second")
        self.age(self.record, 30)
        self.age(other, 20)
        with patch("tokens.tasks.swap_reconciler.SWAP_EXECUTION_RECOVERY_BATCH", 1), patch(
            "tokens.tasks.swap_reconciler.swap_execution.recover", return_value="signed"
        ) as recover:
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 0})
        recover.assert_called_once_with(self.record.pk)


class UnwindingASwapTwiceCostsTheOrdersNothingExtraTest(TestCase):

    def setUp(self):
        self.tenant = make_tenant("unwinder")
        self.swap = self.tenant.swap
        self.filled_before = self.swap.share_amount * 3
        TransferOrder.objects.filter(pk__in=[self.swap.sell_order_id, self.swap.buy_order_id]).update(
            quantity=self.filled_before, filled_quantity=self.filled_before, status=TransferOrderStatus.MATCHED
        )
        self.swap = SwapOrder.objects.select_related("sell_order", "buy_order").get(pk=self.swap.pk)

    def filled(self):
        return [
            TransferOrder.objects.get(pk=pk).filled_quantity for pk in (self.swap.sell_order_id, self.swap.buy_order_id)
        ]

    def test_a_second_unwind_does_not_subtract_the_share_amount_again(self):
        self.swap.mark_failed("first")
        after_one = self.filled()

        self.swap.mark_failed("second")

        self.assertEqual(after_one, [self.filled_before - self.swap.share_amount] * 2)
        self.assertEqual(self.filled(), after_one)

    def test_the_orders_start_far_enough_above_the_share_amount_for_a_second_subtraction_to_show(self):
        self.assertGreater(self.filled_before - 2 * self.swap.share_amount, 0)

    def test_the_reason_recorded_is_the_one_that_actually_failed_it(self):
        self.swap.mark_failed("the chain refused it")
        self.swap.mark_failed("a later sweep guessed")

        self.swap.refresh_from_db()
        self.assertEqual(self.swap.error_message, "the chain refused it")


class TwoSwapsCannotShareANonceTest(TestCase):

    def test_the_database_refuses_a_second_swap_with_the_same_nonce(self):
        tenant = make_tenant("nonces")
        first = tenant.swap

        with self.assertRaises(IntegrityError):
            save_swap_with_context(
                sell_order=first.sell_order,
                buy_order=first.buy_order,
                share_token=first.share_token,
                payment_asset=first.payment_asset,
                seller_address=first.seller_address,
                buyer_address=first.buyer_address,
                share_amount=first.share_amount,
                payment_amount=first.payment_amount,
                nonce=first.nonce,
                order_hash="0x" + "ab" * 32,
                expires_at=first.expires_at + timedelta(seconds=1),
                status=SwapOrderStatus.CREATED,
            )

    def test_a_different_nonce_is_accepted_so_the_constraint_is_about_the_nonce(self):
        tenant = make_tenant("nonces-ok")
        first = tenant.swap

        second = save_swap_with_context(
            sell_order=first.sell_order,
            buy_order=first.buy_order,
            share_token=first.share_token,
            payment_asset=first.payment_asset,
            seller_address=first.seller_address,
            buyer_address=first.buyer_address,
            share_amount=first.share_amount,
            payment_amount=first.payment_amount,
            nonce=first.nonce + 1,
            order_hash="0x" + "cd" * 32,
            expires_at=first.expires_at,
            status=SwapOrderStatus.CREATED,
        )

        self.assertNotEqual(second.pk, first.pk)


class TheNonceGeneratorDoesNotRelyOnTheConstraintTest(TestCase):
    def test_nonces_drawn_together_are_not_neighbours_around_a_shared_clock(self):
        drawn = [atomic_swap_service._generate_nonce() for _ in range(200)]

        self.assertEqual(len(set(drawn)), len(drawn))
        self.assertGreater(max(drawn) - min(drawn), 2**40)

    def test_the_generator_reads_no_clock(self):
        source = inspect.getsource(atomic_swap_service._generate_nonce)

        self.assertNotIn("time", source)
        self.assertIn("randbits", source)
