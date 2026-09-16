from copy import deepcopy
from decimal import Decimal, localcontext
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from eth_account.messages import encode_typed_data
from rest_framework.exceptions import APIException
from rest_framework.test import APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from operators.settlement import require_deployment
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.settlement import save_swap_with_context
from shared.tests.tenants import make_tenant
from tokens.exceptions import InsufficientBalanceException, SettlementContextChanged
from tokens.models import SwapOrder, TransferOrder
from tokens.services import (
    atomic_swap_service,
    market_data_service,
    token_transfer_service,
)
from tokens.services.settlement_context import recorded_settlement_context
from tokens.tests.swap_state_fixtures import BUYER, SELLER
from wallets.models import Wallet


@override_settings(ATOMIC_SWAP_ADDRESS="0x" + "9d" * 20)
class SettlementPaymentUnitsTest(APITransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("payment-units", with_swap=False)
        self.asset = self.tenant.refs.stablecoin
        self.deployment = AssetChainDeployment.objects.get(asset=self.asset, chain="base")

    def scales(self, pricing, deployment):
        Asset.objects.filter(pk=self.asset.pk).update(decimals=pricing)
        AssetChainDeployment.objects.filter(pk=self.deployment.pk).update(decimals=deployment)

    def create(self, shares=3, price="1.23"):
        return atomic_swap_service.create_swap_order(
            self.tenant.order, self.tenant.counter_order, share_amount=shares, price_per_share=Decimal(price)
        )

    def order_state(self):
        return list(
            TransferOrder.objects.filter(pk__in=[self.tenant.order.pk, self.tenant.counter_order.pk])
            .order_by("pk")
            .values()
        )

    def quantities(self, quantity):
        TransferOrder.objects.filter(pk__in=[self.tenant.order.pk, self.tenant.counter_order.pk]).update(
            quantity=quantity
        )

    def test_new_swap_uses_the_captured_deployment_scale_in_both_directions(self):
        for pricing, deployment, expected in ((6, 2, 369), (2, 6, 3690000), (2, 2, 369)):
            with self.subTest(pricing=pricing, deployment=deployment):
                self.scales(pricing, deployment)
                with patch("tokens.services.atomic_swap_service.get_base_chain_client") as provider:
                    swap = self.create()
                provider.assert_not_called()
                context = recorded_settlement_context(swap)
                self.assertEqual(swap.payment_amount, expected)
                self.assertEqual(context["typed_data"]["message"]["paymentAmount"], str(expected))
                self.assertEqual(context["payment_asset"]["deployment_decimals"], deployment)

    def test_unrepresentable_payment_refuses_before_swap_or_parent_writes(self):
        self.scales(2, 0)
        before = self.order_state()
        with self.assertRaisesMessage(APIException, "cannot be represented"):
            self.create()
        self.assertFalse(SwapOrder.objects.exists())
        self.assertEqual(self.order_state(), before)

    def test_matching_refusal_rolls_back_the_original_reservations(self):
        self.scales(2, 0)
        before = self.order_state()
        with self.assertRaisesMessage(APIException, "cannot be represented"):
            token_transfer_service.match_orders(self.tenant.counter_order, self.tenant.order, match_quantity=3)
        self.assertFalse(SwapOrder.objects.exists())
        self.assertEqual(self.order_state(), before)

    def test_whole_total_is_allowed_even_when_the_unit_price_is_fractional(self):
        self.scales(2, 0)
        self.quantities(100)
        swap = self.create(shares=100)
        self.assertEqual(swap.payment_amount, 123)

    def test_calculation_is_independent_of_ambient_decimal_precision(self):
        self.scales(2, 2)
        self.quantities(9007199254740993)
        with localcontext() as context:
            context.prec = 6
            swap = self.create(shares=9007199254740993, price="1.50")
        self.assertEqual(swap.payment_amount, 1351079888211148950)

    def test_unstorable_payment_refuses_before_any_write(self):
        self.scales(2, 18)
        before = self.order_state()
        with self.assertRaisesMessage(APIException, "supported settlement range"):
            self.create(shares=10, price="1")
        self.assertFalse(SwapOrder.objects.exists())
        self.assertEqual(self.order_state(), before)

    def test_the_largest_storable_whole_share_and_payment_amounts_are_accepted(self):
        self.scales(2, 0)
        maximum = 2**63 - 1
        self.quantities(maximum)
        swap = self.create(shares=maximum, price="1")
        self.assertEqual((swap.share_amount, swap.payment_amount), (maximum, maximum))
        self.assertEqual(recorded_settlement_context(swap)["typed_data"]["message"]["paymentAmount"], str(maximum))

    def test_invalid_share_counts_and_prices_refuse_without_writing(self):
        before = self.order_state()
        for shares in (0, -1, True, Decimal("1.5"), 2**63):
            with self.subTest(shares=shares), self.assertRaises(APIException):
                self.create(shares=shares)
            self.assertFalse(SwapOrder.objects.exists())
            self.assertEqual(self.order_state(), before)
        for price in ("0", "-1", "NaN", "Infinity", "1E100"):
            with self.subTest(price=price), self.assertRaises(APIException):
                self.create(price=price)
            self.assertFalse(SwapOrder.objects.exists())
            self.assertEqual(self.order_state(), before)

    def test_calculation_and_capture_share_one_deployment_snapshot(self):
        self.scales(6, 2)

        def resolve_then_change(asset):
            deployment = require_deployment(asset)
            AssetChainDeployment.objects.filter(pk=deployment.pk).update(decimals=8)
            return deployment

        with patch("tokens.services.atomic_swap_service.require_deployment", side_effect=resolve_then_change) as lookup:
            swap = self.create()
        lookup.assert_called_once()
        context = recorded_settlement_context(swap)
        self.assertEqual(swap.payment_amount, 369)
        self.assertEqual(context["typed_data"]["message"]["paymentAmount"], "369")
        self.assertEqual(context["payment_asset"]["deployment_decimals"], 2)
        with self.assertRaises(SettlementContextChanged):
            atomic_swap_service.assert_current_settlement(swap)

    def complete_history(self, *swaps):
        self.addCleanup(restore_every_migration)
        historical = migrate_to([("tokens", "0056_hold_legacy_swaps")]).get_model("tokens", "SwapOrder")
        completed_at = timezone.now()
        for swap in swaps:
            historical.objects.filter(pk=swap.pk).update(
                seller_signature=swap.seller_signature,
                buyer_signature=swap.buyer_signature,
                status="completed",
                completed_at=completed_at,
            )
        restore_every_migration()

    def test_completed_trade_uses_its_original_scale_after_configuration_changes(self):
        swap = self.create()
        original = deepcopy(swap.settlement_context)
        self.complete_history(swap)
        self.scales(6, 8)
        summary = market_data_service.market_summaries([self.tenant.deployed_token])[self.tenant.deployed_token.pk]
        detail = market_data_service.get_market_data(self.tenant.deployed_token)
        self.assertEqual(Decimal(summary["last_price"]), Decimal("1.23"))
        self.assertEqual(Decimal(detail["lastTradePrice"]), Decimal("1.23"))
        self.assertEqual(Decimal(detail["lastTrade"]["payment_amount"]), Decimal("3.69"))
        swap.refresh_from_db()
        self.assertEqual(swap.payment_amount, 369)
        self.assertEqual(swap.settlement_context, original)

    def test_history_keeps_all_payment_digits_under_low_ambient_precision(self):
        self.scales(2, 2)
        self.quantities(9007199254740993)
        swap = self.create(shares=9007199254740993, price="0.01")
        self.complete_history(swap)
        with localcontext() as context:
            context.prec = 2
            summary = market_data_service.market_summaries([self.tenant.deployed_token])[self.tenant.deployed_token.pk]
            detail = market_data_service.get_market_data(self.tenant.deployed_token)
        self.assertEqual(Decimal(summary["last_price"]), Decimal("0.01"))
        self.assertEqual(Decimal(detail["lastTradePrice"]), Decimal("0.01"))
        self.assertEqual(detail["lastTrade"]["payment_amount"], "90071992547409.93")

    def test_original_v1_history_reports_signed_amounts_even_when_the_quoted_price_was_wrong(self):
        self.scales(6, 2)
        self.asset.refresh_from_db()
        orders = []
        for party, kind in ((SELLER, "sell"), (BUYER, "buy")):
            wallet = Wallet.objects.create(user_account=self.tenant.account, address=party.address, chain="base")
            orders.append(
                TransferOrder.objects.create(
                    token=self.tenant.deployed_token,
                    payment_asset=self.asset,
                    wallet=wallet,
                    owner_account=self.tenant.account,
                    wallet_address=party.address,
                    order_type=kind,
                    quantity=3,
                    price_per_share=Decimal("1.23"),
                )
            )
        swap = save_swap_with_context(
            sell_order=orders[0],
            buy_order=orders[1],
            share_token=self.tenant.deployed_token,
            payment_asset=self.asset,
            seller_address=SELLER.address,
            buyer_address=BUYER.address,
            share_amount=3,
            payment_amount=3690000,
            nonce=123456789,
        )
        self.assertEqual(swap.settlement_context["price_per_share"], "1.23")
        self.assertEqual(swap.settlement_context["payment_asset"]["pricing_decimals"], 6)
        self.assertEqual(swap.settlement_context["payment_asset"]["deployment_decimals"], 2)
        signable = encode_typed_data(full_message=recorded_settlement_context(swap)["typed_data"])
        swap.seller_signature = SELLER.sign_message(signable).signature.to_0x_hex()
        swap.buyer_signature = BUYER.sign_message(signable).signature.to_0x_hex()
        self.complete_history(swap)
        before = SwapOrder.objects.filter(pk=swap.pk).values().get()
        summary = market_data_service.market_summaries([self.tenant.deployed_token])[self.tenant.deployed_token.pk]
        detail = market_data_service.get_market_data(self.tenant.deployed_token)
        self.assertEqual(Decimal(summary["last_price"]), Decimal("12300"))
        self.assertEqual(Decimal(detail["lastTradePrice"]), Decimal("12300"))
        self.assertEqual(Decimal(detail["lastTrade"]["payment_amount"]), Decimal("36900"))
        self.assertEqual(SwapOrder.objects.filter(pk=swap.pk).values().get(), before)
        self.assertTrue(atomic_swap_service.verify_signature(swap, swap.seller_signature, SELLER.address))
        self.assertTrue(atomic_swap_service.verify_signature(swap, swap.buyer_signature, BUYER.address))

    def test_equal_completion_times_select_the_same_trade_and_scale_in_both_market_reads(self):
        self.scales(2, 2)
        first = self.create()
        self.scales(2, 3)
        second = self.create(price="2.34")
        self.complete_history(first, second)
        self.scales(6, 8)
        expected_price, expected_payment = {
            first.pk: ("1.23", "3.69"),
            second.pk: ("2.34", "7.02"),
        }[max(first.pk, second.pk)]
        summary = market_data_service.market_summaries([self.tenant.deployed_token])[self.tenant.deployed_token.pk]
        detail = market_data_service.get_market_data(self.tenant.deployed_token)
        self.assertEqual(Decimal(summary["last_price"]), Decimal(expected_price))
        self.assertEqual(Decimal(detail["lastTradePrice"]), Decimal(expected_price))
        self.assertEqual(Decimal(detail["lastTrade"]["payment_amount"]), Decimal(expected_payment))


@skipUnless(getattr(settings, "MIGRATION_MODULES", {}).get("tokens", "enabled") is not None, "Requires migrations")
@override_settings(ATOMIC_SWAP_ADDRESS="0x" + "9d" * 20)
class SettlementPaymentHistoryMigrationTest(APITransactionTestCase):
    def test_legacy_market_history_keeps_its_existing_pricing_scale_without_inventing_a_deployment(self):
        tenant = make_tenant("payment-history", with_swap=False)
        swap = atomic_swap_service.create_swap_order(
            tenant.order, tenant.counter_order, share_amount=3, price_per_share=Decimal("1.23")
        )
        self.addCleanup(restore_every_migration)
        historical = migrate_to([("tokens", "0038_order_action_submissions")]).get_model("tokens", "SwapOrder")
        historical.objects.filter(pk=swap.pk).update(status="completed", completed_at=timezone.now())
        before = historical.objects.filter(pk=swap.pk).values().get()
        restore_every_migration()
        AssetChainDeployment.objects.filter(asset=tenant.refs.stablecoin, chain="base").update(decimals=8)
        summary = market_data_service.market_summaries([tenant.deployed_token])[tenant.deployed_token.pk]
        detail = market_data_service.get_market_data(tenant.deployed_token)
        self.assertEqual(Decimal(summary["last_price"]), Decimal("1.23"))
        self.assertEqual(Decimal(detail["lastTradePrice"]), Decimal("1.23"))
        self.assertEqual(Decimal(detail["lastTrade"]["payment_amount"]), Decimal("3.69"))
        after = SwapOrder.objects.filter(pk=swap.pk).values().get()
        self.assertEqual(after.pop("settlement_protocol_version"), 0)
        self.assertIsNone(after.pop("settlement_context"))
        self.assertEqual(after.pop("settlement_digest"), "")
        self.assertEqual(after, before)


class SettlementBalanceDisplayTest(SimpleTestCase):
    def test_a_single_unit_shortage_above_float_precision_stays_visible(self):
        refusal = InsufficientBalanceException(
            balance=9007199254740992, required=9007199254740993, token_symbol="TUSD", decimals=2
        )
        self.assertEqual(
            str(refusal.detail),
            "Insufficient balance: you have 90,071,992,547,409.92 TUSD but need 90,071,992,547,409.93",
        )
