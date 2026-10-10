from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

from django.db import connections
from django.test import TransactionTestCase

from shared.db import acting_for
from tokens.models import TransferOrderStatus
from tokens.services.trading_order_create import execute_order_submission
from tokens.tests.book_fixtures import BUY, SELL, BookFixtures

OPEN = TransferOrderStatus.OPEN
HELD = TransferOrderStatus.HELD
MATCHED = TransferOrderStatus.PENDING_SIGNATURE


class TheBookNeverCrossesTest(BookFixtures, TransactionTestCase):
    def create_together(self, *submissions):
        together = Barrier(len(submissions), timeout=10)

        def submit(submission):
            try:
                together.wait()
                with acting_for(submission[0].pk):
                    return execute_order_submission(*submission)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(len(submissions)) as pool:
            results = [future.result(timeout=30) for future in [pool.submit(submit, item) for item in submissions]]
        return sorted((self.created(result) for result in results), key=lambda order: (order.created_at, order.pk))

    def test_two_current_orders_created_together_match_without_crossing_the_book(self):
        seller, buyer, other = self.traders[1:4]
        self.place(other, SELL, 10, "2.20")
        self.place(other, BUY, 10, "1.90")
        ask = self.signed_submission(seller, SELL, 10, "2.00")
        bid = self.signed_submission(buyer, BUY, 10, "2.00")

        older, newer = self.create_together(ask, bid)

        for order in (older, newer):
            self.assertIsNotNone(order.eligibility_decision_id)
            self.assertIsNotNone(order.creation_submission_id)
        self.assert_uncrossed()
        self.assert_state(older, MATCHED, 10)
        self.assert_state(newer, MATCHED, 10)
        self.assertEqual(self.pending(older).pk, self.pending(newer).pk)
        self.assertEqual(self.book(), ([(Decimal("1.90"), 10)], [(Decimal("2.20"), 10)]))

    def test_a_match_that_lapses_does_not_leave_its_two_orders_crossing(self):
        seller, buyer, other = self.traders[1:4]
        ask = self.place(seller, SELL, 10, "2.00")
        bid = self.place(buyer, BUY, 10, "2.00")

        self.lapse(self.pending(bid))

        self.assert_uncrossed()
        self.assert_state(ask, OPEN, 0)
        self.assertEqual(self.assert_state(bid, HELD, 0).status_label, "Held Back")
        self.assertEqual(self.book(), ([], [(Decimal("2.00"), 10)]))

        self.assertEqual(self.sweep(), {"checked": 1, "matched": 0, "listed": 0, "held": 1, "busy": 0, "crossing": 0})
        self.assert_state(bid, HELD, 0)

        cheaper = self.place(other, SELL, 10, "1.95")
        self.assert_state(cheaper, OPEN, 0)
        self.assert_uncrossed()

        self.sweep()

        self.assert_state(bid, MATCHED, 10)
        self.assertEqual(self.pending(bid).sell_order_id, cheaper.pk)
        self.assert_state(ask, OPEN, 0)
        self.assert_uncrossed()

    def test_a_trade_that_reverts_does_not_leave_its_two_orders_crossing(self):
        seller, buyer = self.traders[1:3]
        ask = self.place(seller, SELL, 10, "2.00")
        bid = self.place(buyer, BUY, 10, "2.00")

        self.revert_match(self.pending(bid))

        self.assert_uncrossed()
        self.assert_state(ask, OPEN, 0)
        self.assertEqual(self.assert_state(bid, HELD, 0).error_message, "Swap execution reverted on chain")
        self.sweep()
        self.assert_state(bid, HELD, 0)

        self.cancel(ask)
        self.sweep()

        self.assert_state(bid, OPEN, 0)
        self.assertEqual(self.book(), ([(Decimal("2.00"), 10)], []))
        self.assertIn("order_listed", self.events)
