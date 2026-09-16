from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.test import TransactionTestCase, override_settings
from rest_framework.test import APITransactionTestCase

from shared.db import use_operator
from tokens.models import TransferOrder, TransferOrderStatus
from tokens.services.swap_expiry import expire_unclaimed_swap
from tokens.services.token_transfer_service import match_orders
from tokens.tests.order_action_fixtures import OTHER_KEY, ActionFixtures
from tokens.tests.order_submission_fixtures import SubmissionFixtures
from tokens.tests.swap_state_fixtures import CONTRACT, swap_service
from tokens.tests.test_swap_expiry import ExpiryFixtures
from wallets.models import Wallet


class SerialSellCreationsShareOneBalanceTest(SubmissionFixtures, APITransactionTestCase):

    def sell(self, quantity):
        signed = self.signed_body(self.body(submission_id=str(uuid4()), order_type="sell", quantity=quantity))
        return self.create(signed), self.submission(signed["submission_id"])

    def sell_quantities(self):
        with use_operator():
            return sorted(
                TransferOrder.objects.filter(wallet=self.wallet, order_type="sell").values_list("quantity", flat=True)
            )

    def test_a_second_sell_cannot_commit_shares_the_first_already_holds(self):
        created, _ = self.sell(90)
        self.assertEqual(created.status_code, 201, created.content)
        refused, submission = self.sell(90)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual((submission.status, submission.refusal_code), ("refused", "insufficient_balance"))
        self.assertEqual(self.sell_quantities(), [90])

    def test_sells_that_fit_the_balance_together_both_open(self):
        for quantity in (40, 40):
            created, _ = self.sell(quantity)
            self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(self.sell_quantities(), [40, 40])


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SignedModificationsCountHeldSharesTest(ActionFixtures, APITransactionTestCase):

    def setUp(self):
        super().setUp()
        self.service = swap_service(self)
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="VERIFIED")

    def sell_order(self, quantity):
        with use_operator():
            return TransferOrder.objects.create(
                token=self.tenant.deployed_token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type="sell",
                quantity=quantity,
                min_quantity=0,
                price_per_share=Decimal("2.50"),
            )

    def held_sell(self, quantity):
        seller = self.sell_order(quantity)
        with use_operator():
            buyer_wallet = Wallet.objects.create(
                user_account=self.tenant.account,
                address=OTHER_KEY.address,
                chain="base",
                verification_status="VERIFIED",
            )
            buy = TransferOrder.objects.create(
                token=self.tenant.deployed_token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=buyer_wallet,
                owner_account=self.tenant.account,
                wallet_address=buyer_wallet.address,
                order_type="buy",
                quantity=quantity,
                min_quantity=0,
                price_per_share=Decimal("2.50"),
            )
            with patch("tokens.services.atomic_swap_service", self.service):
                match_orders(buy, seller, quantity)
        seller.refresh_from_db()
        return seller

    def modification(self, order, new_quantity):
        body = self.modify_body(new_quantity=str(new_quantity), new_min_quantity="0", new_price_per_share="2.50")
        return self.message("modify", body, order=order)

    def test_a_raise_cannot_commit_shares_a_held_match_already_holds(self):
        held = self.held_sell(100)
        self.assertEqual((held.status, held.filled_quantity), (TransferOrderStatus.PENDING_SIGNATURE, 100))
        open_order = self.sell_order(10)
        refused = self.modification(open_order, 100)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("would leave 100 open, with 0 available", refused.json()["detail"])
        open_order.refresh_from_db()
        self.assertEqual(open_order.quantity, 10)
        registered = self.journal()
        self.assertEqual((registered.status, registered.executed_challenge_id), ("pending", None))

    def test_a_raise_is_measured_against_the_whole_open_quantity_of_the_order(self):
        self.held_sell(40)
        open_order = self.sell_order(10)
        refused = self.modification(open_order, 70)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("would leave 70 open, with 60 available", refused.json()["detail"])
        open_order.refresh_from_db()
        self.assertEqual(open_order.quantity, 10)

    def test_a_raise_within_the_unheld_balance_applies(self):
        self.held_sell(40)
        open_order = self.sell_order(10)
        issued = self.modification(open_order, 20)
        self.assertEqual(issued.status_code, 200, issued.content)
        signed = self.sign(issued.json())
        applied = self.execute("modify", signed, order=open_order)
        self.assertEqual(applied.status_code, 200, applied.content)
        self.assertEqual(self.journal(signed["action_id"]).status, "applied")
        open_order.refresh_from_db()
        self.assertEqual(open_order.quantity, 20)


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="")
class CommittedSellQuantityCountsHeldSharesTest(ExpiryFixtures, TransactionTestCase):

    def committed(self, swap):
        return TransferOrder.objects.committed_sell_quantity(swap.share_token, swap.seller_address)

    def test_held_matched_shares_stay_committed_until_expiry_returns_them_to_open(self):
        swap = self.matched_swap()
        self.assertEqual((swap.sell_order.filled_quantity, swap.share_amount), (30, 10))
        self.assertEqual(self.committed(swap), 20)
        self.assertTrue(expire_unclaimed_swap(swap, self.expired_at(swap)))
        self.assertEqual(self.committed(swap), 20)
