import logging
from decimal import Decimal
from typing import Optional

from django.utils import timezone

from operators.settlement import require_deployment
from shared.utils.token_amounts import token_base_units_ceiling
from tokens.exceptions import (
    OrderModificationConflictException,
    OrderModificationException,
)
from tokens.models import (
    OrderModificationLog,
    TransferOrder,
    TransferOrderStatus,
    TransferOrderType,
)
from tokens.services import share_token_service

logger = logging.getLogger(__name__)


def validate_can_modify(order: TransferOrder) -> None:
    if order.has_pending_swap:
        raise OrderModificationConflictException(
            "Cannot modify order with pending swap. Complete or cancel the swap first."
        )

    if order.status not in (TransferOrderStatus.OPEN, TransferOrderStatus.PARTIALLY_FILLED):
        raise OrderModificationException(f"Order with status '{order.get_status_display()}' cannot be modified.")


def validate_modifications(
    order: TransferOrder,
    new_quantity: Optional[int] = None,
    new_min_quantity: Optional[int] = None,
    new_price: Optional[Decimal] = None,
    *,
    observed_balance: Optional[int],
) -> list[str]:
    errors = []
    available_balance = _uncommitted_balance(order, observed_balance)

    effective_quantity = new_quantity if new_quantity is not None else order.quantity
    effective_min_qty = new_min_quantity if new_min_quantity is not None else order.min_quantity
    effective_price = new_price if new_price is not None else order.price_per_share

    if effective_quantity <= order.filled_quantity:
        errors.append(f"New quantity ({effective_quantity}) must exceed filled amount ({order.filled_quantity})")

    remaining = effective_quantity - order.filled_quantity
    if effective_min_qty > remaining:
        errors.append(f"Min quantity ({effective_min_qty}) cannot exceed remaining ({remaining})")

    if effective_min_qty < 0:
        errors.append("Min quantity cannot be negative")

    if effective_price <= 0:
        errors.append("Price must be positive")

    if order.order_type == TransferOrderType.SELL and new_quantity is not None and new_quantity > order.quantity:
        if available_balance is None:
            errors.append("The order has changed. Please request and sign a new modification message.")
        elif remaining > available_balance:
            errors.append(
                f"Insufficient token balance. The order would leave {remaining} open, "
                f"with {available_balance} available."
            )

    if order.order_type == TransferOrderType.BUY and (
        effective_quantity > order.quantity or effective_price > order.price_per_share
    ):
        if available_balance is None:
            errors.append("The order has changed. Please request and sign a new modification message.")
        else:
            commitment = token_base_units_ceiling(
                remaining * effective_price, require_deployment(order.payment_asset).decimals
            )
            if commitment > available_balance:
                errors.append(
                    f"Insufficient {order.payment_asset.symbol} balance. The order would commit {commitment} "
                    f"base units, with {available_balance} available."
                )

    return errors


def apply_order_modification(order, challenge, observed_balance, ip_address=None, user_agent=None):
    validate_can_modify(order)
    intent = challenge.payload["message"]
    new_quantity = int(intent["newQuantity"])
    new_min_quantity = int(intent["newMinQuantity"])
    new_price = Decimal(intent["newPricePerShare"])
    errors = validate_modifications(order, new_quantity, new_min_quantity, new_price, observed_balance=observed_balance)
    if errors:
        raise OrderModificationException("; ".join(errors))
    signature = challenge.consumed_signature
    signer = challenge.wallet_address

    order.record_original_values()

    changes = []

    if new_quantity != order.quantity:
        changes.append(
            {
                "field": "quantity",
                "old": str(order.quantity),
                "new": str(new_quantity),
            }
        )
        order.quantity = new_quantity

    if new_min_quantity != order.min_quantity:
        changes.append(
            {
                "field": "min_quantity",
                "old": str(order.min_quantity),
                "new": str(new_min_quantity),
            }
        )
        order.min_quantity = new_min_quantity

    if new_price != order.price_per_share:
        changes.append(
            {
                "field": "price_per_share",
                "old": str(order.price_per_share),
                "new": str(new_price),
            }
        )
        order.price_per_share = new_price

    order.modification_count += 1
    order.last_modified_at = timezone.now()
    order.current_signature = signature
    order.save()

    OrderModificationLog.objects.bulk_create(
        OrderModificationLog(
            order=order,
            field_name=change["field"],
            old_value=change["old"],
            new_value=change["new"],
            challenge=challenge,
            signature=signature,
            signer_address=signer,
            ip_address=ip_address,
            user_agent=(user_agent or "")[:500],
        )
        for change in changes
    )

    logger.info(f"Modified order {order.uuid}: {len(changes)} field(s) changed")

    return order, changes


def read_modification_balance(order: TransferOrder, quantity: int, price: Optional[Decimal] = None) -> Optional[int]:
    if order.order_type == TransferOrderType.SELL and quantity > order.quantity:
        contract_address = order.token.contract_address
        balance_kind = "token"
    elif order.order_type == TransferOrderType.BUY and (
        quantity > order.quantity or (price is not None and price > order.price_per_share)
    ):
        contract_address = require_deployment(order.payment_asset).contract_address
        balance_kind = "payment"
    else:
        return None
    try:
        return share_token_service.get_token_balance(contract_address, order.wallet_address)
    except Exception:
        logger.error("Could not fetch %s balance for order %s", balance_kind, order.pk)
        raise OrderModificationException(f"Unable to verify {balance_kind} balance. Please try again later.")


def _uncommitted_balance(order: TransferOrder, observed_balance: Optional[int]) -> Optional[int]:
    if observed_balance is None:
        return None
    if order.order_type == TransferOrderType.SELL:
        committed = TransferOrder.objects.committed_sell_quantity(
            token=order.token, wallet_address=order.wallet_address, exclude_uuid=order.uuid
        )
    else:
        deployment = require_deployment(order.payment_asset)
        committed = TransferOrder.objects.committed_buy_payment(
            order.payment_asset, order.wallet_address, deployment.decimals, exclude_uuid=order.uuid
        )
    return max(0, observed_balance - committed)


def get_modification_history(order: TransferOrder) -> dict:
    logs = order.modification_logs.all().order_by("-created_at")

    return {
        "order_uuid": str(order.uuid),
        "original_quantity": order.original_quantity,
        "original_price": str(order.original_price) if order.original_price else None,
        "modification_count": order.modification_count,
        "modifications": [
            {
                "uuid": str(log.uuid),
                "field_name": log.field_name,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "signer_address": log.signer_address,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ],
    }
