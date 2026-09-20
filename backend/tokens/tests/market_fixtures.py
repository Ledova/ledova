from uuid import uuid4

from django.conf import settings
from django.utils import timezone
from web3 import Web3

from operators.models import Operator
from shared.tests.tenants import make_tenant
from tokens.models import OrderSubmission, SigningChallenge
from tokens.services.trading_order_service import TradingOrderService


def record_synthetic_admission(order):
    order.refresh_from_db()
    Operator.get().supported_settlement_assets.set([order.payment_asset])
    order.wallet_address = Web3.to_checksum_address(order.wallet_address)
    order.save(update_fields=["wallet_address"])
    submission = OrderSubmission.objects.create(
        submission_id=uuid4(),
        owner_account=order.owner_account,
        wallet=order.wallet,
        token=order.token,
        initiated_by=order.owner_account.user_profile.user,
        wallet_address=order.wallet_address,
        order_type=order.order_type,
        quantity=order.quantity,
        min_quantity=order.min_quantity,
        price_per_share=order.price_per_share,
        chain_id=settings.BLOCKCHAIN_CHAIN_ID,
        verifying_contract=order.token.contract_address,
        token_metadata={"name": order.token.name, "symbol": order.token.symbol},
    )
    issued = TradingOrderService.get_order_create_message(
        token=order.token,
        wallet_address=order.wallet_address,
        order_type=order.order_type,
        quantity=order.quantity,
        min_quantity=order.min_quantity,
        price_per_share=order.price_per_share,
        wallet=order.wallet,
        submission=submission,
    )
    challenge = SigningChallenge.objects.get(digest=issued["digest"])
    challenge.mark_consumed("synthetic-market-fixture")
    OrderSubmission.objects.filter(pk=submission.pk).update(
        status="created", order=order, executed_challenge=challenge, resolved_at=timezone.now()
    )


def make_market_tenant(label):
    tenant = make_tenant(label)
    for order in (tenant.order, tenant.counter_order):
        record_synthetic_admission(order)
    return tenant
