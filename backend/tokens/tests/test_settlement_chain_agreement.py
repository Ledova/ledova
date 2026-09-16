import secrets
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from operators.settlement import require_deployment
from shared.constants import BLOCKCHAIN_BASE
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.exceptions import InvalidSettlementAmountException, SettlementContextChanged
from tokens.models import (
    OrderSubmission,
    ShareToken,
    ShareTokenStatus,
    SwapOrder,
    TokenDeployment,
    TransferOrder,
    TransferOrderType,
)
from tokens.services.settlement_context import (
    CHAIN_DISAGREEMENT,
    assert_current_settlement,
    capture_settlement_context,
    recorded_settlement_context,
)
from tokens.tests.order_submission_fixtures import COUNTERPARTY, SubmissionFixtures
from tokens.tests.swap_state_fixtures import CONTRACT, make_swap
from wallets.models import Wallet

FOREIGN_CHAIN_ID = 11155111
AGREEING_ADDRESS = "0x" + "6a" * 20
FOREIGN_ADDRESS = "0x" + "6b" * 20
UNJOURNALLED_ADDRESS = "0x" + "6c" * 20
ANOTHER_PAYMENT_ADDRESS = "0x" + "6d" * 20


def factory_intent(token, chain_id):
    return {
        "chain_id": chain_id,
        "sender": "0x" + "1a" * 20,
        "to": "0x" + "2b" * 20,
        "value": "0",
        "data": "0x",
        "name": token.name,
        "symbol": token.symbol,
        "identifier": f"{token.symbol}-1",
        "authorized_shares": token.total_supply,
        "issuer_wallet": "0x" + "3c" * 20,
        "decimals": token.decimals,
    }


def deployed_token(tenant, chain_id, symbol, address, *, journalled=True):
    token = ShareToken.objects.create(
        company=tenant.company,
        name=f"{tenant.label} {symbol} shares",
        symbol=symbol,
        total_supply="1000",
        status=ShareTokenStatus.DEPLOYED,
        contract_address=address,
        chain=BLOCKCHAIN_BASE,
        deployment_id=uuid4(),
    )
    if journalled:
        TokenDeployment.objects.create(
            pk=token.deployment_id,
            token_id=token.pk,
            company_id=token.company_id,
            intent=factory_intent(token, chain_id),
        )
    return token


def unsigned_swap(tenant, token):
    orders = [
        TransferOrder.objects.create(
            token=token,
            payment_asset=tenant.refs.stablecoin,
            wallet=tenant.wallet,
            owner_account=tenant.account,
            wallet_address=tenant.wallet.address,
            order_type=order_type,
            quantity=10,
            price_per_share=Decimal("1.50"),
        )
        for order_type in (TransferOrderType.SELL, TransferOrderType.BUY)
    ]
    return SwapOrder(
        sell_order=orders[0],
        buy_order=orders[1],
        share_token=token,
        payment_asset=tenant.refs.stablecoin,
        seller_address=tenant.wallet.address,
        buyer_address=tenant.wallet.address,
        share_amount=10,
        payment_amount=1500,
        nonce=secrets.randbits(63),
        order_hash="",
        expires_at=timezone.now() + timedelta(hours=1),
    )


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SettlementChainAgreementTest(TransactionTestCase):
    def test_a_capture_refuses_a_share_token_deployed_on_another_chain(self):
        tenant = make_tenant("chain-agreement")
        deployment = require_deployment(tenant.refs.stablecoin)
        agreeing = deployed_token(tenant, settings.BLOCKCHAIN_CHAIN_ID, "AGR", AGREEING_ADDRESS)

        context = capture_settlement_context(unsigned_swap(tenant, agreeing), deployment)

        self.assertEqual(context["typed_data"]["domain"]["chainId"], str(settings.BLOCKCHAIN_CHAIN_ID))
        self.assertEqual(context["share_token"]["uuid"], str(agreeing.pk))
        self.assertNotIn("chain_id", context["share_token"])

        refused = (
            deployed_token(tenant, FOREIGN_CHAIN_ID, "FGN", FOREIGN_ADDRESS),
            deployed_token(tenant, settings.BLOCKCHAIN_CHAIN_ID, "ORP", UNJOURNALLED_ADDRESS, journalled=False),
        )
        for token in refused:
            with self.subTest(token=token.symbol):
                swap = unsigned_swap(tenant, token)
                with self.assertRaises(InvalidSettlementAmountException) as caught:
                    capture_settlement_context(swap, deployment)
                self.assertEqual(caught.exception.detail.code, "invalid_settlement_amount")
                self.assertEqual(str(caught.exception.detail), CHAIN_DISAGREEMENT)
                self.assertEqual(swap.order_hash, "")
                self.assertFalse(SwapOrder.objects.filter(share_token=token).exists())


class SettlementChainRefusalJournalTest(SubmissionFixtures, APITransactionTestCase):
    def test_a_foreign_chain_capture_is_a_durable_refusal_in_the_submission_journal(self):
        with use_operator():
            token = deployed_token(self.tenant, FOREIGN_CHAIN_ID, "FGN", FOREIGN_ADDRESS)
            counterparty = Wallet.objects.create(
                user_account=self.tenant.account,
                address=COUNTERPARTY.address,
                chain="base",
                verification_status="VERIFIED",
            )
            TransferOrder.objects.create(
                token=token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=counterparty,
                owner_account=self.tenant.account,
                wallet_address=counterparty.address,
                order_type=TransferOrderType.SELL,
                quantity=10,
                price_per_share=Decimal("2.50"),
            )
            before_orders = TransferOrder.objects.count()
            before_swaps = SwapOrder.objects.count()

        refused = self.create(self.signed_body(self.body(token=str(token.pk))))

        self.assertEqual(refused.status_code, 400, refused.content)
        snapshot = refused.json()
        self.assertEqual(snapshot["status"], "refused")
        self.assertEqual(snapshot["refusal"], {"code": "invalid_settlement_amount", "detail": CHAIN_DISAGREEMENT})
        self.assertIsNone(snapshot["order"])
        self.assertIsNone(snapshot["match"])
        self.assertEqual(self.recover().json(), snapshot)
        with use_operator():
            recorded = OrderSubmission.objects.get(owner_account=self.tenant.account, submission_id=self.submission_id)
            self.assertEqual(recorded.refusal_code, "invalid_settlement_amount")
            self.assertEqual(recorded.refusal_detail, CHAIN_DISAGREEMENT)
            self.assertIsNotNone(recorded.resolved_at)
            self.assertEqual(TransferOrder.objects.count(), before_orders)
            self.assertEqual(SwapOrder.objects.count(), before_swaps)
        self.assertEqual(self.events, [])


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SettlementDriftTermsTest(TransactionTestCase):
    def setUp(self):
        self.swap = make_swap("chain-agreement-drift")
        self.context = recorded_settlement_context(self.swap)
        self.deployment = AssetChainDeployment.objects.get(pk=self.context["payment_asset"]["deployment_uuid"])

    def test_a_replaced_payment_deployment_refuses_at_the_same_address_and_scale(self):
        assert_current_settlement(self.swap)
        AssetChainDeployment.objects.filter(pk=self.deployment.pk).delete()
        replacement = AssetChainDeployment.objects.create(
            asset_id=self.deployment.asset_id,
            chain=self.deployment.chain,
            contract_address=self.deployment.contract_address,
            decimals=self.deployment.decimals,
        )

        self.assertNotEqual(replacement.pk, self.deployment.pk)
        self.assertEqual(
            (replacement.contract_address, replacement.decimals),
            (self.deployment.contract_address, self.deployment.decimals),
        )
        with self.assertRaises(SettlementContextChanged):
            assert_current_settlement(self.swap)

    def test_a_moved_payment_deployment_address_refuses(self):
        assert_current_settlement(self.swap)
        AssetChainDeployment.objects.filter(pk=self.deployment.pk).update(contract_address=ANOTHER_PAYMENT_ADDRESS)

        with self.assertRaises(SettlementContextChanged):
            assert_current_settlement(self.swap)

    def test_a_changed_pricing_scale_refuses_without_touching_the_deployment(self):
        assert_current_settlement(self.swap)
        Asset.objects.filter(pk=self.swap.payment_asset_id).update(decimals=6)

        self.assertEqual(
            AssetChainDeployment.objects.get(pk=self.deployment.pk).decimals,
            self.context["payment_asset"]["deployment_decimals"],
        )
        with self.assertRaises(SettlementContextChanged):
            assert_current_settlement(self.swap)

    def test_a_share_token_recorded_on_another_chain_refuses(self):
        assert_current_settlement(self.swap)
        ShareToken.objects.filter(pk=self.swap.share_token_id).update(chain="ethereum")

        with self.assertRaises(SettlementContextChanged):
            assert_current_settlement(self.swap)

    def test_the_database_pins_share_decimals_so_no_drift_term_can_watch_them(self):
        self.assertEqual(self.context["share_token"]["decimals"], 0)
        with self.assertRaises(IntegrityError), transaction.atomic():
            ShareToken.objects.filter(pk=self.swap.share_token_id).update(decimals=1)

        self.assertEqual(ShareToken.objects.get(pk=self.swap.share_token_id).decimals, 0)
        assert_current_settlement(self.swap)


class ScopedSettlementChainAgreementTest(RunsOnTheScopedConnection, APITransactionTestCase):
    @override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
    def test_the_deployment_chain_is_read_over_the_operator_connection(self):
        with self.as_an_operator_would():
            tenant = make_tenant("chain-agreement-scoped")
            deployment = require_deployment(tenant.refs.stablecoin)
            agreeing = deployed_token(tenant, settings.BLOCKCHAIN_CHAIN_ID, "AGR", AGREEING_ADDRESS)
            foreign = deployed_token(tenant, FOREIGN_CHAIN_ID, "FGN", FOREIGN_ADDRESS)
            admitted = unsigned_swap(tenant, agreeing)
            refused = unsigned_swap(tenant, foreign)
        self.the_principal_the_middleware_would_set(tenant.user)

        context = capture_settlement_context(admitted, deployment)

        self.assertEqual(context["share_token"]["uuid"], str(agreeing.pk))
        with self.assertRaises(InvalidSettlementAmountException):
            capture_settlement_context(refused, deployment)
