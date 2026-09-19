from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.test import TransactionTestCase, override_settings
from rest_framework.test import APITransactionTestCase

from assets.models import AssetChainDeployment
from operators.settlement import require_deployment
from shared.db import use_operator
from tokens.models import TransferOrder
from tokens.services.swap_expiry import expire_unclaimed_swap
from tokens.tests.order_action_fixtures import ActionFixtures
from tokens.tests.order_submission_fixtures import SubmissionFixtures
from tokens.tests.swap_state_fixtures import CONTRACT
from tokens.tests.test_swap_expiry import ExpiryFixtures


class SerialBuyCreationsShareOnePaymentBalanceTest(SubmissionFixtures, APITransactionTestCase):

    def setUp(self):
        super().setUp()
        self.payment_balance = 3000

    def buy(self, quantity):
        signed = self.signed_body(self.body(submission_id=str(uuid4()), quantity=quantity))
        return self.create(signed), self.submission(signed["submission_id"])

    def buy_quantities(self):
        with use_operator():
            return sorted(
                TransferOrder.objects.filter(wallet=self.wallet, order_type="buy").values_list("quantity", flat=True)
            )

    def test_a_second_buy_cannot_commit_payment_the_first_already_holds(self):
        created, _ = self.buy(10)
        self.assertEqual(created.status_code, 201, created.content)
        refused, submission = self.buy(10)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual((submission.status, submission.refusal_code), ("refused", "insufficient_balance"))
        self.assertEqual(self.buy_quantities(), [10])

    def test_buys_that_fit_the_payment_balance_together_both_open(self):
        for quantity in (5, 5):
            created, _ = self.buy(quantity)
            self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(self.buy_quantities(), [5, 5])

    def test_an_open_buy_the_asset_cannot_represent_exactly_commits_its_ceiling(self):
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=0)
        self.counter_order(order_type="buy", quantity=1, price="1.23", wallet=self.wallet)
        self.payment_balance = 26
        refused, submission = self.buy(10)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(submission.refusal_code, "insufficient_balance")
        self.payment_balance = 27
        created, _ = self.buy(10)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(self.buy_quantities(), [1, 10])


class SignedBuyModificationsAreMeasuredAgainstPaymentTest(ActionFixtures, APITransactionTestCase):

    def setUp(self):
        super().setUp()
        self.payment_balance = 3000

    def modification(self, quantity, price):
        body = self.modify_body(new_quantity=str(quantity), new_min_quantity="0", new_price_per_share=price)
        return self.message("modify", body)

    def assert_refused(self, quantity, price):
        refused = self.modification(quantity, price)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("base units", refused.json()["detail"])
        self.order.refresh_from_db()
        self.assertEqual((self.order.quantity, str(self.order.price_per_share)), (10, "2.50"))

    def test_a_quantity_raise_beyond_the_payment_balance_is_refused(self):
        self.assert_refused(13, "2.50")

    def test_a_price_raise_beyond_the_payment_balance_is_refused(self):
        self.assert_refused(10, "3.10")

    def test_a_raise_within_the_payment_balance_applies(self):
        issued = self.modification(12, "2.50")
        self.assertEqual(issued.status_code, 200, issued.content)
        signed = self.sign(issued.json())
        applied = self.execute("modify", signed)
        self.assertEqual(applied.status_code, 200, applied.content)
        self.assertEqual(self.journal(signed["action_id"]).status, "applied")
        self.order.refresh_from_db()
        self.assertEqual(self.order.quantity, 12)
        self.assertEqual(self.provider_states, [False] * len(self.provider_states))
        self.assertTrue(self.provider_states)

    def test_another_open_buy_of_the_wallet_reduces_what_a_raise_may_commit(self):
        with use_operator():
            TransferOrder.objects.create(
                token=self.tenant.deployed_token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type="buy",
                quantity=4,
                min_quantity=0,
                price_per_share=Decimal("2.50"),
            )
        self.assert_refused(12, "2.50")

    def test_a_raise_first_seen_under_the_lock_is_refused_until_re_signed(self):
        issued = self.modification(12, "2.50")
        self.assertEqual(issued.status_code, 200, issued.content)
        signed = self.sign(issued.json())
        with patch("tokens.services.order_actions.read_modification_balance", return_value=None):
            refused = self.execute("modify", signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("The order has changed", refused.json()["refusal"]["detail"])
        self.order.refresh_from_db()
        self.assertEqual(self.order.quantity, 10)


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="")
class CommittedBuyPaymentCountsHeldSwapsTest(ExpiryFixtures, TransactionTestCase):

    def committed(self, swap):
        decimals = require_deployment(swap.payment_asset).decimals
        return TransferOrder.objects.committed_buy_payment(swap.payment_asset, swap.buyer_address, decimals)

    def test_held_payment_stays_committed_until_expiry_returns_it_to_open(self):
        swap = self.matched_swap()
        self.assertEqual((swap.buy_order.filled_quantity, swap.payment_amount), (30, 1500))
        self.assertEqual(self.committed(swap), 3000)
        self.assertTrue(expire_unclaimed_swap(swap, self.expired_at(swap)))
        self.assertEqual(self.committed(swap), 3000)
