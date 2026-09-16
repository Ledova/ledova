from uuid import uuid4

from rest_framework.test import APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from operators.models import Operator
from shared.db import use_operator
from tokens.models import OrderSubmission, TransferOrder
from tokens.tests.order_submission_fixtures import COUNTERPARTY, SubmissionFixtures
from wallets.models import Wallet


class OrdersCarryTheSoleSettlementAssetTest(SubmissionFixtures, APITransactionTestCase):

    def configure(self, *assets):
        with use_operator():
            Operator.get().supported_settlement_assets.set(assets)

    def second_stablecoin(self):
        with use_operator():
            asset = Asset.objects.create(
                name="Second dollar",
                symbol="TUSD2",
                asset_type="stablecoin",
                decimals=2,
                is_active=True,
                is_verified=True,
            )
            AssetChainDeployment.objects.create(asset=asset, chain="base", contract_address="0x" + "6" * 40, decimals=2)
            return asset

    def test_two_signed_orders_carry_the_asset_and_form_a_swap(self):
        sell = self.create(self.signed_body(self.body(order_type="sell", quantity=10)))
        self.assertEqual(sell.status_code, 201, sell.content)
        with use_operator():
            counterparty = Wallet.objects.create(
                user_account=self.tenant.account,
                address=COUNTERPARTY.address,
                chain="base",
                verification_status="VERIFIED",
            )
        buy_body = self.body(
            submission_id=str(uuid4()),
            wallet_uuid=str(counterparty.pk),
            wallet_address=counterparty.address,
            order_type="buy",
            quantity=10,
        )
        buy = self.create(self.signed_body(buy_body, signer=COUNTERPARTY))
        self.assertEqual(buy.status_code, 201, buy.content)
        with use_operator():
            swap = self.submission(buy_body["submission_id"]).initial_swap
            self.assertIsNotNone(swap)
            self.assertEqual(swap.payment_asset, self.tenant.refs.stablecoin)
            parents = TransferOrder.objects.filter(pk__in=[swap.sell_order_id, swap.buy_order_id])
            self.assertEqual(set(parents.values_list("payment_asset_id", flat=True)), {self.tenant.refs.stablecoin.pk})

    def test_no_configured_settlement_asset_refuses_the_message(self):
        self.configure()
        refused = self.message()
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("exactly one configured settlement asset", refused.json()["token"])
        with use_operator():
            self.assertFalse(OrderSubmission.objects.filter(submission_id=self.submission_id).exists())

    def test_two_configured_settlement_assets_refuse_the_message(self):
        self.configure(self.tenant.refs.stablecoin, self.second_stablecoin())
        refused = self.message()
        self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertFalse(OrderSubmission.objects.filter(submission_id=self.submission_id).exists())

    def test_a_configuration_change_after_the_message_refuses_execution(self):
        signed = self.signed_body()
        self.configure(self.tenant.refs.stablecoin, self.second_stablecoin())
        refused = self.create(signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assert_pending_and_unspent(signed)
