from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.test import TestCase, override_settings

from assets.models import AssetChainDeployment
from operators.models import Operator, ReceivingChain
from shared.tests.tenants import make_tenant
from tokens.exceptions import SettlementContextChanged
from tokens.filters import TransferOrderFilter
from tokens.models import TransferOrder
from tokens.services import atomic_swap_service
from tokens.services.atomic_swap_service import payment_address
from tokens.services.settlement_context import (
    assert_current_settlement,
)

BASE_ADDRESS = "0x" + "5" * 40
ETHEREUM_ADDRESS = "0x" + "e" * 40
RECIPIENT = "0x" + "d" * 40


class SwapSettlementAddressTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("alice")
        self.asset = self.tenant.refs.stablecoin
        AssetChainDeployment.objects.create(
            asset=self.asset, chain="ethereum", contract_address=ETHEREUM_ADDRESS, decimals=2
        )

    def test_a_new_swap_keeps_its_original_payment_address_after_receiving_chain_changes(self):
        self.assertEqual(self.asset.chain_deployments.first().contract_address, BASE_ADDRESS)
        self.assertEqual(payment_address(self.tenant.swap), BASE_ADDRESS)

        operator = Operator.get()
        operator.receiving_wallet_chain = ReceivingChain.ETHEREUM
        operator.save(update_fields=["receiving_wallet_chain"])

        self.assertEqual(payment_address(self.tenant.swap), BASE_ADDRESS)
        with self.assertRaises(SettlementContextChanged):
            assert_current_settlement(self.tenant.swap)

    @patch("whitelist.services.whitelist.get_base_chain_client")
    @patch("tokens.services.atomic_swap_service.get_base_chain_client")
    def test_a_matched_pair_creates_a_swap_priced_in_the_settlement_asset_units(self, chain_client, _whitelist):
        chain_client.return_value = MagicMock(
            chain_id=31337, to_checksum_address=lambda address: address.replace("0X", "0x")
        )
        service = atomic_swap_service

        with override_settings(ATOMIC_SWAP_ADDRESS=RECIPIENT):
            swap = service.create_swap_order(
                sell_order=self.tenant.order,
                buy_order=self.tenant.counter_order,
                share_amount=4,
                price_per_share=Decimal("1.50"),
            )

        self.assertEqual(swap.payment_asset, self.asset)
        self.assertEqual(swap.payment_amount, 600)


class TransferOrderFilterTest(TestCase):
    def test_orders_can_be_filtered_by_their_settlement_asset(self):
        tenant = make_tenant("alice")
        filtered = TransferOrderFilter(
            {"payment_asset": str(tenant.refs.stablecoin.uuid)}, queryset=TransferOrder.objects.all()
        )

        self.assertEqual(filtered.qs.count(), 2)
        self.assertEqual(
            TransferOrderFilter({"payment_asset": str(uuid4())}, queryset=TransferOrder.objects.all()).qs.count(), 0
        )
