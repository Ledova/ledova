import logging
import secrets
from datetime import timedelta
from decimal import Decimal, localcontext
from typing import Optional

from django.conf import settings
from django.utils import timezone
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from integrations.base_chain import get_base_chain_client
from operators.settlement import require_deployment
from shared.db import atomic
from shared.utils.token_amounts import token_base_units
from tokens.constants import MAX_SETTLEMENT_UNITS
from tokens.exceptions import (
    AtomicSwapNotConfiguredException,
    InvalidSettlementAmountException,
    SettlementApprovalUncertain,
    SettlementContextChanged,
)
from tokens.models import (
    SwapOrder,
    SwapOrderStatus,
    TransferOrder,
    TransferOrderStatus,
    TransferOrderType,
)
from tokens.services.settlement_context import (
    assert_current_settlement,
    capture_settlement_context,
    recorded_settlement_context,
)
from tokens.services.signed_transactions import decode_signed_transaction
from tokens.services.trading_locks import (
    hash_identity,
    lock_orders,
)

logger = logging.getLogger(__name__)

MAX_UINT256 = 2**256 - 1


def payment_address(swap_order) -> str:
    return recorded_settlement_context(swap_order)["typed_data"]["message"]["paymentToken"]


def configured_relayer_key() -> str:
    key = getattr(settings, "BLOCKCHAIN_OPERATOR_KEY", None)
    if not key:
        raise AtomicSwapNotConfiguredException("Relayer private key not configured")
    return key


def get_typed_data(swap_order: SwapOrder) -> dict:
    return recorded_settlement_context(swap_order)["typed_data"]


def _generate_nonce() -> int:
    return secrets.randbits(63)


def settlement_contract(swap_order):
    return recorded_settlement_context(swap_order)["typed_data"]["domain"]["verifyingContract"]


def assert_provider_settlement(swap_order):
    context = assert_current_settlement(swap_order)
    try:
        actual_chain = get_base_chain_client().assert_expected_chain()
    except Exception as exc:
        raise SettlementContextChanged() from exc
    if actual_chain != int(context["typed_data"]["domain"]["chainId"]):
        raise SettlementContextChanged()
    assert_current_settlement(swap_order)


def check_allowance(token_address: str, owner_address: str, spender) -> int:
    token_contract = get_base_chain_client().load_contract("ShareToken", token_address)
    allowance = get_base_chain_client().call_contract_function(
        token_contract.functions.allowance(
            get_base_chain_client().to_checksum_address(owner_address),
            get_base_chain_client().to_checksum_address(spender),
        )
    )
    return allowance


def check_swap_allowances(swap_order: SwapOrder) -> dict:
    assert_provider_settlement(swap_order)
    context = recorded_settlement_context(swap_order)
    share_address = context["share_token"]["address"]
    spender = settlement_contract(swap_order)
    seller_allowance = check_allowance(
        share_address,
        swap_order.seller_address,
        spender,
    )
    seller_has_allowance = seller_allowance >= swap_order.share_amount

    buyer_allowance = check_allowance(
        payment_address(swap_order),
        swap_order.buyer_address,
        spender,
    )
    buyer_has_allowance = buyer_allowance >= swap_order.payment_amount

    assert_provider_settlement(swap_order)
    return {
        "seller": {
            "address": swap_order.seller_address,
            "token": share_address,
            "token_symbol": context["share_token"]["symbol"],
            "required_amount": swap_order.share_amount,
            "current_allowance": seller_allowance,
            "has_sufficient_allowance": seller_has_allowance,
        },
        "buyer": {
            "address": swap_order.buyer_address,
            "token": payment_address(swap_order),
            "token_symbol": context["payment_asset"]["symbol"],
            "required_amount": swap_order.payment_amount,
            "current_allowance": buyer_allowance,
            "has_sufficient_allowance": buyer_has_allowance,
        },
    }


def get_approval_transaction_data(
    swap_order: SwapOrder,
    user_role: str,
    unlimited: bool = True,
) -> dict:
    assert_provider_settlement(swap_order)
    context = recorded_settlement_context(swap_order)
    if user_role == "seller":
        token_address = context["share_token"]["address"]
        owner_address = swap_order.seller_address
        amount = MAX_UINT256 if unlimited else swap_order.share_amount
        token_symbol = context["share_token"]["symbol"]
    elif user_role == "buyer":
        token_address = payment_address(swap_order)
        owner_address = swap_order.buyer_address
        amount = MAX_UINT256 if unlimited else swap_order.payment_amount
        token_symbol = context["payment_asset"]["symbol"]
    else:
        raise ValueError(f"Invalid user_role: {user_role}")

    token_contract = get_base_chain_client().load_contract("ShareToken", token_address)
    approve_fn = token_contract.functions.approve(
        get_base_chain_client().to_checksum_address(settlement_contract(swap_order)),
        amount,
    )
    tx = get_base_chain_client().build_transaction(
        approve_fn,
        from_address=owner_address,
    )
    assert_provider_settlement(swap_order)
    return {
        "transaction": {
            "to": token_address,
            "from": owner_address,
            "data": tx.get("data", ""),
            "value": "0x0",
            "gas": hex(tx.get("gas", 100000)),
            "gasPrice": hex(tx.get("gasPrice", 0)),
            "nonce": hex(tx.get("nonce", 0)),
            "chainId": hex(get_base_chain_client().chain_id),
        },
        "description": f"Approve AtomicSwap contract to transfer {token_symbol}",
        "token_address": token_address,
        "token_symbol": token_symbol,
        "spender": settlement_contract(swap_order),
        "amount": str(amount),
        "unlimited": unlimited,
    }


def broadcast_settlement_approval(swap_order, user_role, signed_transaction, admission):
    from tokens.services import token_transfer_service
    from tokens.services.trading_order_access import require_pending_settlement

    context = require_pending_settlement(swap_order)
    try:
        raw_transaction = bytes.fromhex(signed_transaction.removeprefix("0x"))
        decoded = decode_signed_transaction(raw_transaction)
    except ValueError as exc:
        raise SettlementContextChanged() from exc
    token = (
        context["share_token"]["address"] if user_role == "seller" else context["payment_asset"]["deployment_address"]
    )
    spender = context["typed_data"]["domain"]["verifyingContract"]
    expected_data = (
        bytes.fromhex("095ea7b3") + bytes.fromhex(spender[2:]).rjust(32, b"\x00") + MAX_UINT256.to_bytes(32, "big")
    )
    if (
        decoded.sender != context[user_role]["address"]
        or decoded.chain_id != int(context["typed_data"]["domain"]["chainId"])
        or decoded.to != token
        or decoded.value != 0
        or decoded.data != expected_data
    ):
        raise SettlementContextChanged()
    assert_provider_settlement(swap_order)
    current = admission(swap_order)
    require_pending_settlement(current)
    expected_hash = Web3.to_hex(Web3.keccak(raw_transaction))
    try:
        returned_hash, receipt = token_transfer_service.broadcast_transfer(signed_transaction)
        if (
            hash_identity(returned_hash) != hash_identity(expected_hash)
            or hash_identity(receipt.get("transactionHash")) != hash_identity(expected_hash)
            or type(receipt.get("status")) is not int
            or receipt["status"] != 1
        ):
            raise SettlementApprovalUncertain(expected_hash)
    except Exception as exc:
        raise SettlementApprovalUncertain(expected_hash) from exc
    return expected_hash, receipt


@atomic()
def create_swap_order(
    sell_order: TransferOrder,
    buy_order: TransferOrder,
    expires_hours: Optional[float] = None,
    share_amount: Optional[int] = None,
    price_per_share=None,
) -> SwapOrder:
    locked = {
        order.pk: order for order in lock_orders(TransferOrder.objects.filter(pk__in=[sell_order.pk, buy_order.pk]))
    }
    sell_order = locked[sell_order.pk]
    buy_order = locked[buy_order.pk]
    if sell_order.order_type != TransferOrderType.SELL:
        raise ValueError("sell_order must be a SELL order")
    if buy_order.order_type != TransferOrderType.BUY:
        raise ValueError("buy_order must be a BUY order")

    token = sell_order.token
    payment_asset = buy_order.payment_asset or sell_order.payment_asset

    if not payment_asset:
        raise ValueError("Payment asset must be specified on at least one order")

    if share_amount is None:
        share_amount = sell_order.quantity

    if price_per_share is None:
        price_per_share = sell_order.price_per_share

    if (
        type(share_amount) is not int
        or not 0 < share_amount <= MAX_SETTLEMENT_UNITS
        or not isinstance(price_per_share, Decimal)
        or not price_per_share.is_finite()
        or price_per_share <= 0
    ):
        raise InvalidSettlementAmountException()
    deployment = require_deployment(payment_asset)
    with localcontext() as context:
        context.prec = max(78, len(price_per_share.as_tuple().digits) + len(str(share_amount)))
        try:
            payment_amount = token_base_units(share_amount * price_per_share, deployment.decimals)
        except ValueError as exc:
            raise InvalidSettlementAmountException() from exc
    if payment_amount > MAX_SETTLEMENT_UNITS:
        raise InvalidSettlementAmountException()
    nonce = _generate_nonce()

    if expires_hours is None:
        expires_hours = getattr(settings, "SWAP_ORDER_EXPIRY_HOURS", 0.25)
    expires_at = timezone.now() + timedelta(hours=expires_hours)

    swap_order = SwapOrder(
        sell_order=sell_order,
        buy_order=buy_order,
        share_token=token,
        payment_asset=payment_asset,
        seller_address=Web3.to_checksum_address(sell_order.wallet_address),
        buyer_address=Web3.to_checksum_address(buy_order.wallet_address),
        share_amount=share_amount,
        payment_amount=payment_amount,
        nonce=nonce,
        order_hash="",
        expires_at=expires_at,
        expiry_release_eligible=True,
        status=SwapOrderStatus.CREATED,
    )
    capture_settlement_context(swap_order, deployment, price_per_share)
    swap_order.save()

    sell_order.status = TransferOrderStatus.PENDING_SIGNATURE
    sell_order.save(update_fields=["status", "updated_at"])
    buy_order.status = TransferOrderStatus.PENDING_SIGNATURE
    buy_order.save(update_fields=["status", "updated_at"])

    logger.info(f"Created swap order {swap_order.uuid}: {share_amount} shares for {payment_amount} payment")

    return swap_order


def verify_signature(swap_order: SwapOrder, signature: str, expected_signer: str) -> bool:
    try:
        typed_data = get_typed_data(swap_order)
        structured_message = encode_typed_data(full_message=typed_data)
        recovered = Account.recover_message(structured_message, signature=signature)
        expected_checksum = Web3.to_checksum_address(expected_signer)

        return recovered.lower() == expected_checksum.lower()
    except Exception as e:
        logger.warning(f"Signature verification failed: {e}", exc_info=True)
        return False
