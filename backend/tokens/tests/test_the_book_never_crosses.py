from decimal import Decimal
from uuid import uuid4

from django.test import TransactionTestCase
from rest_framework.test import APITransactionTestCase

from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.utils.typed_data import signable_message
from tokens.models import (
    OrderActionSubmission,
    SwapOrder,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.tasks.held_orders import place_held_orders
from tokens.tests.book_fixtures import BUY, SELL, BookFixtures
from tokens.tests.order_submission_fixtures import BASE, COUNTERPARTY
from tokens.tests.test_cross_account_matching import CrossAccountMatchingFixtures

OPEN = TransferOrderStatus.OPEN
PARTIAL = TransferOrderStatus.PARTIALLY_FILLED
HELD = TransferOrderStatus.HELD
MATCHED = TransferOrderStatus.PENDING_SIGNATURE
COMPLETED = TransferOrderStatus.COMPLETED
CANCELLED = TransferOrderStatus.CANCELLED


class TheBookNeverCrossesTest(BookFixtures, TransactionTestCase):
    def test_a_large_bid_left_over_after_its_first_trade_settles_does_not_cross_the_book(self):
        first, second, buyer = self.traders[1:4]
        self.place(first, SELL, 10, "2.00")
        ask = self.place(second, SELL, 50, "2.10")
        bid = self.place(buyer, BUY, 100, "2.50")
        self.assert_uncrossed()

        self.settle_match(self.pending(bid))

        self.assert_uncrossed()
        self.assertEqual(self.book(), ([], [(Decimal("2.10"), 50)]))
        self.assertEqual(self.assert_state(bid, HELD, 10).status_label, "Partially Filled, Remainder Held Back")

        self.assertEqual(self.sweep()["matched"], 1)

        self.assert_uncrossed()
        self.assertEqual(self.book(), ([], []))
        self.assert_state(bid, MATCHED, 60)
        self.assertEqual(self.pending(bid).sell_order_id, ask.pk)
        self.assertEqual(self.events.count("order_matched"), 2)

        self.settle_match(self.pending(bid))

        self.assert_uncrossed()
        self.assert_state(bid, PARTIAL, 60)
        self.assert_state(ask, COMPLETED, 50)
        self.assertEqual(self.book(), ([(Decimal("2.50"), 40)], []))

    def test_an_order_back_from_its_trade_does_not_cross_one_that_arrived_meanwhile(self):
        seller, first, second = self.traders[1:4]
        ask = self.place(seller, SELL, 100, "2.00")
        self.place(first, BUY, 10, "2.10")
        later = self.place(second, BUY, 50, "2.05")
        self.assert_uncrossed()

        self.settle_match(self.pending(ask))

        self.assert_uncrossed()
        self.assert_state(ask, HELD, 10)
        self.assertEqual(self.book(), ([(Decimal("2.05"), 50)], []))

        self.sweep()

        self.assert_state(ask, MATCHED, 60)
        self.assertEqual(self.pending(ask).buy_order_id, later.pk)
        self.assert_uncrossed()

    def test_a_match_that_lapses_does_not_leave_its_two_orders_crossing(self):
        seller, buyer, other = self.traders[1:4]
        ask = self.place(seller, SELL, 10, "2.00")
        bid = self.place(buyer, BUY, 10, "2.00")

        self.lapse(self.pending(bid))

        self.assert_uncrossed()
        self.assert_state(ask, OPEN, 0)
        self.assertEqual(self.assert_state(bid, HELD, 0).status_label, "Held Back")
        self.assertEqual(self.book(), ([], [(Decimal("2.00"), 10)]))

        self.assertEqual(self.sweep(), {"checked": 1, "matched": 0, "listed": 0, "held": 1, "busy": 0})
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

    def test_a_bid_above_its_own_wallets_ask_is_held_until_that_ask_goes(self):
        trader = self.traders[1]
        ask = self.place(trader, SELL, 10, "2.00")

        bid = self.place(trader, BUY, 10, "2.10")

        self.assert_uncrossed()
        self.assert_state(bid, HELD, 0)
        self.sweep()
        self.assert_state(bid, HELD, 0)

        self.cancel(ask)
        self.assert_state(bid, HELD, 0)
        self.assertEqual(self.sweep()["listed"], 1)

        self.assert_state(bid, OPEN, 0)
        self.assertEqual(self.book(), ([(Decimal("2.10"), 10)], []))

    def test_a_bid_short_of_an_asks_minimum_fill_is_held_until_it_can_meet_it(self):
        seller, buyer = self.traders[1:3]
        self.place(seller, SELL, 100, "2.00", minimum=100)

        bid = self.place(buyer, BUY, 10, "2.10")

        self.assert_uncrossed()
        self.assert_state(bid, HELD, 0)

        bid = self.modify(bid, quantity=100)

        self.assertEqual((bid.status, bid.quantity), (HELD, 100))
        self.assert_uncrossed()
        self.sweep()
        self.assert_state(bid, MATCHED, 100)

    def test_a_modified_price_does_not_cross_the_book(self):
        seller, buyer = self.traders[1:3]
        ask = self.place(seller, SELL, 10, "2.20")
        bid = self.place(buyer, BUY, 10, "2.00")

        self.modify(bid, price="2.30")

        self.assert_uncrossed()
        self.assert_state(bid, HELD, 0)
        self.sweep()
        self.assert_state(bid, MATCHED, 10)
        self.assertEqual(self.pending(bid).sell_order_id, ask.pk)

    def test_a_held_remainder_can_be_modified_back_into_the_book_and_cancelled(self):
        first, second, buyer = self.traders[1:4]
        self.place(first, SELL, 10, "2.00")
        self.place(second, SELL, 50, "2.10")
        bid = self.place(buyer, BUY, 100, "2.50")
        self.settle_match(self.pending(bid))
        self.assert_state(bid, HELD, 10)

        self.modify(bid, price="2.05")

        self.assert_state(bid, PARTIAL, 10)
        self.assertEqual(self.book(), ([(Decimal("2.05"), 90)], [(Decimal("2.10"), 50)]))

        self.modify(bid, price="2.20")

        self.assert_state(bid, HELD, 10)
        self.assert_uncrossed()

        self.cancel(bid)

        self.assert_state(bid, CANCELLED, 10)
        self.assertEqual(self.book(), ([], [(Decimal("2.10"), 50)]))
        with use_operator():
            cancellation = OrderActionSubmission.objects.get(order=bid, purpose="cancel")
        self.assertEqual(cancellation.result, {"kind": "cancel", "from_status": "held", "to_status": "cancelled"})

    def test_a_held_order_is_not_matched_by_a_new_order_and_still_commits_its_payment(self):
        seller, buyer, other = self.traders[1:4]
        self.place(seller, SELL, 10, "2.00")
        bid = self.place(buyer, BUY, 10, "2.00")
        self.lapse(self.pending(bid))
        self.assert_state(bid, HELD, 0)

        ask = self.place(other, SELL, 5, "1.90")

        self.assert_state(ask, OPEN, 0)
        self.assert_state(bid, HELD, 0)
        with use_operator():
            committed = TransferOrder.objects.committed_buy_payment(bid.payment_asset, bid.wallet_address, 2)
        self.assertEqual(committed, 2000)

    def test_a_sweep_with_nothing_to_change_writes_nothing(self):
        trader = self.traders[1]
        self.place(trader, SELL, 10, "2.00")
        bid = self.place(trader, BUY, 10, "2.10")
        before = self.current(bid).updated_at
        self.events.clear()

        self.assertEqual(self.sweep()["held"], 1)

        self.assertEqual(self.current(bid).updated_at, before)
        self.assertEqual(self.events, [])


class TheInvestorSeesAHeldOrderTest(BookFixtures, APITransactionTestCase):
    def test_a_held_remainder_reads_as_partially_filled_and_held_back_and_can_be_changed(self):
        first, second, buyer = self.traders[1:4]
        self.place(first, SELL, 10, "2.00")
        self.place(second, SELL, 50, "2.10")
        bid = self.place(buyer, BUY, 100, "2.50")
        self.settle_match(self.pending(bid))
        self.client.force_authenticate(buyer.user)

        orders = self.client.get("/api/v1/trading/orders/", {"wallet_address": buyer.wallet.address})
        context = self.client.get(
            f"/api/v1/trading/orders/{bid.pk}/action-context/", {"owner_account_uuid": str(buyer.account.pk)}
        )

        self.assertEqual(orders.status_code, 200, orders.content)
        (row,) = orders.json()["results"]
        self.assertEqual(
            (row["status"], row["statusDisplay"], row["filledQuantity"], row["remainingQuantity"]),
            ("held", "Partially Filled, Remainder Held Back", 10, 90),
        )
        values = context.json()["currentValues"]
        self.assertEqual((values["status"], values["canCancel"], values["canModify"]), ("held", True, True))


class HeldAcrossAccountsChecks(CrossAccountMatchingFixtures):
    def buyer_modify(self, order_id, price):
        self.client.force_authenticate(self.buyer.user)
        identity = {"action_id": str(uuid4()), "owner_account_uuid": str(self.buyer.account.pk)}
        terms = {"new_quantity": "10", "new_min_quantity": "0", "new_price_per_share": price}
        message = self.client.post(f"{BASE}{order_id}/modify/message/", identity | terms, format="json")
        self.assertEqual(message.status_code, 200, message.content)
        challenge = message.json()["challenge"]
        signature = COUNTERPARTY.sign_message(
            signable_message(challenge["domain"], challenge["types"], challenge["message"])
        ).signature.to_0x_hex()
        return self.client.post(
            f"{BASE}{order_id}/modify/",
            identity | {"digest": challenge["digest"], "signature": signature},
            format="json",
        )

    def listed(self):
        self.client.force_authenticate(self.buyer.user)
        book = self.client.get(f"/api/v1/trading/tokens/{self.tenant.deployed_token.pk}/order-book/").json()
        return [level["price"] for level in book["buyOrders"]], [level["price"] for level in book["sellOrders"]]

    def test_a_bid_modified_across_a_foreign_ask_is_held_back_until_the_sweep_matches_it(self):
        seller_id = self.seller_order()
        created = self.create(self.buyer_intent(price="1.00"))
        self.assertEqual(created.status_code, 201, created.content)
        bid_id = created.json()["order"]["uuid"]
        self.assertEqual(self.listed(), (["1.00"], ["2.50"]))

        modified = self.buyer_modify(bid_id, "3.00")

        self.assertEqual(modified.status_code, 200, modified.content)
        self.assertEqual(
            (modified.json()["status"], modified.json()["order"]["status"], modified.json()["order"]["statusDisplay"]),
            ("applied", "held", "Held Back"),
        )
        self.assertEqual(self.listed(), ([], ["2.50"]))

        self.assertEqual(place_held_orders()["matched"], 1)

        with use_operator():
            swap = SwapOrder.objects.get(buy_order_id=bid_id)
            self.assertEqual((str(swap.sell_order_id), swap.share_amount), (seller_id, 10))
            self.assertEqual(TransferOrder.objects.get(pk=bid_id).status, TransferOrderStatus.PENDING_SIGNATURE)
        self.assertEqual(self.listed(), ([], []))


class HeldAcrossAccountsTest(HeldAcrossAccountsChecks, APITransactionTestCase):
    pass


class ScopedHeldAcrossAccountsTest(RunsOnTheScopedConnection, HeldAcrossAccountsChecks, APITransactionTestCase):
    pass
