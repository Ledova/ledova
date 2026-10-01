import random
from contextlib import closing

from django.db.models import Q, Sum
from django.test import TransactionTestCase

from shared.db import use_operator
from tokens.models import SwapOrder, SwapOrderStatus, TransferOrder, TransferOrderStatus
from tokens.services.token_transfer_service import find_matching_orders
from tokens.tests.book_fixtures import BUY, SELL, BookFixtures

PRICES = ("1.90", "1.95", "2.00", "2.05", "2.10")
STEPS = 45
FILLING = [SwapOrderStatus.COMPLETED, *SwapOrderStatus.unsettled()]


class BookSequencesTest(BookFixtures, TransactionTestCase):
    def orders(self, **filters):
        with use_operator():
            return list(TransferOrder.objects.filter(token=self.token, **filters).order_by("created_at", "pk"))

    def awaiting(self):
        with use_operator():
            return list(SwapOrder.objects.filter(share_token=self.token, status=SwapOrderStatus.CREATED).order_by("pk"))

    def step(self, rng):
        changeable = self.orders(status__in=TransferOrderStatus.changeable())
        awaiting = self.awaiting()
        moves = ["place"] * 5 + ["sweep"] * 2 + ["cancel", "modify"] * bool(changeable)
        moves += ["settle", "settle", "lapse", "lapse", "revert"] * bool(awaiting)
        move = rng.choice(moves)
        if move == "place":
            quantity = rng.randint(1, 30)
            self.place(
                rng.choice(self.traders),
                rng.choice((BUY, SELL)),
                quantity,
                rng.choice(PRICES),
                minimum=quantity if rng.random() < 0.1 else 0,
            )
        elif move == "sweep":
            self.sweep()
            self.assert_every_held_order_crosses_with_nothing_to_take()
        elif move == "cancel":
            self.cancel(rng.choice(changeable))
        elif move == "modify":
            self.modify(rng.choice(changeable), price=rng.choice(PRICES))
        elif move == "settle":
            self.settle_match(rng.choice(awaiting))
        elif move == "lapse":
            self.lapse(rng.choice(awaiting))
        else:
            self.revert_match(rng.choice(awaiting))
        return move

    def assert_every_held_order_crosses_with_nothing_to_take(self):
        with use_operator():
            for order in TransferOrder.objects.held().filter(token=self.token):
                self.assertTrue(TransferOrder.objects.crossing(order).exists(), order.pk)
                with closing(find_matching_orders(order)) as candidates:
                    self.assertIsNone(next(candidates, None), order.pk)

    def assert_fills_follow_the_matches(self):
        with use_operator():
            for order in TransferOrder.objects.filter(token=self.token):
                swaps = SwapOrder.objects.filter(Q(sell_order=order) | Q(buy_order=order))
                filled = swaps.filter(status__in=FILLING).aggregate(total=Sum("share_amount"))["total"] or 0
                self.assertEqual(order.filled_quantity, filled, order.pk)
                matched = swaps.filter(status__in=SwapOrderStatus.unsettled()).exists()
                self.assertEqual(order.status == TransferOrderStatus.PENDING_SIGNATURE, matched, order.pk)

    def run_sequence(self, seed):
        rng = random.Random(seed)
        moves = []
        for _ in range(STEPS):
            moves.append(self.step(rng))
            self.assert_uncrossed()
            self.assert_fills_follow_the_matches()
        self.assertTrue({"place", "sweep", "settle", "lapse"} <= set(moves), moves)

    def test_a_random_sequence_of_market_events_never_leaves_the_book_crossed(self):
        self.run_sequence(846)

    def test_another_random_sequence_of_market_events_never_leaves_the_book_crossed(self):
        self.run_sequence(1002)

    def test_a_third_random_sequence_of_market_events_never_leaves_the_book_crossed(self):
        self.run_sequence(31337)
