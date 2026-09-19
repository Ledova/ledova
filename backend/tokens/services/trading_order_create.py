from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from web3 import Web3

from operators.settlement import settlement_assets
from shared.db import atomic, current_alias, use_operator
from tokens.exceptions import (
    ChallengeMismatchException,
    CreateOrderInsufficientBalanceException,
    CreateOrderNotWhitelistedException,
    InvalidSettlementAmountException,
    OrderSubmissionConflictException,
    SettlementChainDisagreement,
)
from tokens.models import (
    OrderSubmission,
    OrderSubmissionStatus,
    ShareToken,
    TransferOrder,
    TransferOrderType,
)
from tokens.services import token_transfer_service
from tokens.services.signing_challenge import spend
from tokens.services.trading_order_service import TradingOrderService
from users.models import UserAccount
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.models.wallet import Blockchain

NOT_FOUND = "Order submission not found."
BUSINESS_REFUSALS = {
    CreateOrderNotWhitelistedException: "not_whitelisted",
    CreateOrderInsufficientBalanceException: "insufficient_balance",
    InvalidSettlementAmountException: "invalid_settlement_amount",
    SettlementChainDisagreement: "settlement_chain_disagreement",
}


@dataclass(frozen=True)
class SubmissionResult:
    submission: OrderSubmission
    created: bool = False
    challenge: dict | None = None


def _independent_boundary():
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise ImproperlyConfigured("Order submissions require autocommit outside every transaction block.")


def _find_submission(account_id, submission_id):
    return (
        OrderSubmission.objects.select_for_update(of=("self",))
        .filter(owner_account_id=account_id, submission_id=submission_id)
        .first()
    )


def _assert_original_terms(submission, data):
    expected = (
        submission.owner_account_id,
        submission.wallet_id,
        submission.token_id,
        submission.wallet_address,
        submission.order_type,
        submission.quantity,
        submission.min_quantity,
        submission.price_per_share,
    )
    actual = (
        data["owner_account_uuid"],
        data["wallet_uuid"],
        data["token"],
        data["wallet_address"],
        data["order_type"],
        data["quantity"],
        data["min_quantity"],
        data["price_per_share"],
    )
    if actual != expected:
        raise OrderSubmissionConflictException()


def _lock_authorized_wallet(actor, submission):
    wallet = Wallet.objects.select_for_update(of=("self",), no_key=True).filter(pk=submission.wallet_id).first()
    if wallet is None or wallet.user_account_id != submission.owner_account_id:
        raise NotFound(NOT_FOUND)
    if not (
        actor is not None
        and actor.is_authenticated
        and UserAccount.objects.select_for_update(of=("self",), no_key=True)
        .filter(pk=submission.owner_account_id, user_profile__user=actor)
        .exists()
    ):
        raise NotFound(NOT_FOUND)
    if not Web3.is_address(wallet.address) or Web3.to_checksum_address(wallet.address) != submission.wallet_address:
        raise NotFound(NOT_FOUND)
    return wallet


def _eligible_token(token_id, wallet):
    if wallet.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED or wallet.chain not in (
        Blockchain.ETHEREUM.value,
        Blockchain.BASE.value,
    ):
        raise ValidationError({"wallet_uuid": "Select a verified EVM wallet from your own account."})
    token = ShareToken.objects.filter(pk=token_id).first()
    if token is None:
        raise ValidationError({"token": "Token not found"})
    if not token.is_deployed:
        raise ValidationError({"token": "Token is not deployed"})
    return token


def _settlement_asset():
    assets = list(settlement_assets()[:2])
    if len(assets) != 1:
        raise ValidationError({"token": "Orders need exactly one configured settlement asset."})
    return assets[0]


def _pending_token(submission, wallet):
    token = _eligible_token(submission.token_id, wallet)
    if submission.chain_id != settings.BLOCKCHAIN_CHAIN_ID:
        raise ChallengeMismatchException("chain")
    if token.contract_address.lower() != submission.verifying_contract.lower():
        raise ChallengeMismatchException("contract")
    return token, _settlement_asset()


def _recover_order(submission):
    if submission.order_id is not None:
        order = TransferOrder.objects.ownership_bound().filter(pk=submission.order_id).first()
        if order is None or (order.wallet_id, order.owner_account_id, order.token_id, order.wallet_address) != (
            submission.wallet_id,
            submission.owner_account_id,
            submission.token_id,
            submission.wallet_address,
        ):
            raise NotFound(NOT_FOUND)
        submission.order = order


def issue_order_submission(actor, data):
    _independent_boundary()
    with atomic(durable=True):
        submission = _find_submission(data["owner_account_uuid"], data["submission_id"])
        if submission is None:
            token = _eligible_token(data["token"], data["wallet"])
            submission, _ = OrderSubmission.objects.get_or_create(
                owner_account_id=data["owner_account_uuid"],
                submission_id=data["submission_id"],
                defaults={
                    "wallet_id": data["wallet_uuid"],
                    "token": token,
                    "initiated_by": actor,
                    "wallet_address": data["wallet_address"],
                    "order_type": data["order_type"],
                    "quantity": data["quantity"],
                    "min_quantity": data["min_quantity"],
                    "price_per_share": data["price_per_share"],
                    "chain_id": settings.BLOCKCHAIN_CHAIN_ID,
                    "verifying_contract": token.contract_address,
                    "token_metadata": {"name": token.name, "symbol": token.symbol},
                },
            )
            submission = OrderSubmission.objects.select_for_update(of=("self",)).get(pk=submission.pk)
        _assert_original_terms(submission, data)
        wallet = _lock_authorized_wallet(actor, submission)
        if submission.status != OrderSubmissionStatus.PENDING:
            _recover_order(submission)
            return SubmissionResult(submission)
        token, _ = _pending_token(submission, wallet)
        challenge = TradingOrderService.get_order_create_message(
            token=token,
            wallet_address=submission.wallet_address,
            order_type=submission.order_type,
            quantity=submission.quantity,
            min_quantity=submission.min_quantity,
            price_per_share=submission.price_per_share,
            wallet=wallet,
            submission=submission,
        )
        return SubmissionResult(submission, challenge=challenge)


def execute_order_submission(actor, data):
    _independent_boundary()
    if actor is None or not actor.is_authenticated:
        raise NotFound(NOT_FOUND)
    admitted = OrderSubmission.objects.filter(
        owner_account_id=data["owner_account_uuid"],
        submission_id=data["submission_id"],
        owner_account__user_profile__user=actor,
    ).first()
    if admitted is None:
        raise NotFound(NOT_FOUND)
    _assert_original_terms(admitted, data)
    if (
        admitted.status == OrderSubmissionStatus.PENDING
        and not ShareToken.objects.filter(pk=admitted.token_id).exists()
    ):
        raise ValidationError({"token": "Token not found"})
    with use_operator():
        _independent_boundary()
        return _execute_authorized_submission(actor, data)


def _execute_authorized_submission(actor, data):
    with atomic(durable=True):
        submission = _find_submission(data["owner_account_uuid"], data["submission_id"])
        if submission is None:
            raise NotFound(NOT_FOUND)
        _assert_original_terms(submission, data)
        wallet = _lock_authorized_wallet(actor, submission)
        if submission.status != OrderSubmissionStatus.PENDING:
            _recover_order(submission)
            return SubmissionResult(submission)
        token, payment_asset = _pending_token(submission, wallet)
        challenge = TradingOrderService.verify_order_create_signature(
            wallet_address=submission.wallet_address,
            token_uuid=str(submission.token_id),
            order_type=submission.order_type,
            quantity=submission.quantity,
            min_quantity=submission.min_quantity,
            price_per_share=submission.price_per_share,
            digest=data.get("digest"),
            signature=data.get("signature"),
            submission=submission,
        )
        spend(challenge, data["signature"])
        try:
            with atomic():
                order, match = token_transfer_service.create_order_and_match(
                    token=token,
                    order_type=submission.order_type,
                    actor=actor,
                    wallet=wallet,
                    owner_account=wallet.user_account,
                    wallet_address=submission.wallet_address,
                    quantity=submission.quantity,
                    min_quantity=submission.min_quantity,
                    price_per_share=submission.price_per_share,
                    payment_asset=payment_asset,
                )
        except tuple(BUSINESS_REFUSALS) as exc:
            if type(exc) not in BUSINESS_REFUSALS:
                raise
            submission.status = OrderSubmissionStatus.REFUSED
            submission.refusal_code = BUSINESS_REFUSALS[type(exc)]
            submission.refusal_detail = str(exc.detail)
        else:
            submission.status = OrderSubmissionStatus.CREATED
            submission.order = order
            if match is not None:
                submission.initial_counter_order = match[
                    "buy_order" if submission.order_type == TransferOrderType.SELL else "sell_order"
                ]
                submission.initial_swap = match["swap_order"]
        submission.executed_challenge = challenge
        submission.resolved_at = timezone.now()
        submission.save(
            update_fields=[
                "status",
                "order",
                "initial_counter_order",
                "initial_swap",
                "refusal_code",
                "refusal_detail",
                "executed_challenge",
                "resolved_at",
                "updated_at",
            ]
        )
        _recover_order(submission)
        return SubmissionResult(submission, created=submission.status == OrderSubmissionStatus.CREATED)


@atomic()
def recover_order_submission(actor, account_id, submission_id):
    submission = _find_submission(account_id, submission_id)
    if submission is None:
        raise NotFound(NOT_FOUND)
    _lock_authorized_wallet(actor, submission)
    _recover_order(submission)
    return SubmissionResult(submission)
