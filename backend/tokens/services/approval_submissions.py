import logging
from collections.abc import Mapping
from datetime import timedelta

from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException
from web3 import Web3

from integrations.base_chain import get_base_chain_client
from integrations.blockchain.receipts import (
    nonnegative_integer,
    normalized_hash,
    transaction_hash_matches,
)
from shared.db import atomic, use_operator
from tokens.constants import MAX_UINT256, SWAP_APPROVAL_RESEND_SECONDS
from tokens.exceptions import (
    SettlementApprovalConflict,
    SettlementApprovalPending,
    SettlementContextChanged,
)
from tokens.models import ApprovalSubmissionOutcome, SwapApprovalSubmission, SwapOrder
from tokens.services.settlement_context import recorded_settlement_context
from tokens.services.signed_transactions import decode_signed_transaction
from tokens.services.trading_order_access import require_pending_settlement

logger = logging.getLogger(__name__)
MAX_RECORDED_NONCE = 2**63 - 1
MAX_RECEIPT_INTEGER = 2**63 - 1
PENDING = ApprovalSubmissionOutcome.PENDING


def approve_calldata(spender):
    return bytes.fromhex("095ea7b3") + bytes.fromhex(spender[2:]).rjust(32, b"\x00") + MAX_UINT256.to_bytes(32, "big")


def party_terms(context, participant):
    token = (
        context["share_token"]["address"] if participant == "seller" else context["payment_asset"]["deployment_address"]
    )
    return {
        "chain_id": int(context["typed_data"]["domain"]["chainId"]),
        "sender_address": context[participant]["address"].lower(),
        "token_address": token.lower(),
        "spender_address": context["typed_data"]["domain"]["verifyingContract"].lower(),
    }


def refuse_pending(swap, participant):
    terms = party_terms(recorded_settlement_context(swap), participant)
    with use_operator():
        pending = SwapApprovalSubmission.objects.filter(outcome=PENDING, **terms).exists()
    if pending:
        raise SettlementApprovalPending()


def recorded_outcome(swap, participant, tx_hash):
    context = recorded_settlement_context(swap)
    party = context[participant]
    with use_operator():
        return (
            SwapApprovalSubmission.objects.filter(
                tx_hash=tx_hash.lower(),
                owner_account_id=party["owner_account_uuid"],
                wallet_id=party["wallet_uuid"],
                **party_terms(context, participant),
            )
            .values("tx_hash", "outcome")
            .first()
        )


def record(swap, participant, raw, decoded, actor_id):
    context = recorded_settlement_context(swap)
    terms = party_terms(context, participant)
    tx_hash = Web3.keccak(raw).to_0x_hex()
    with use_operator(), atomic(durable=True):
        locked = SwapOrder.objects.select_for_update(of=("self",)).get(pk=swap.pk)
        require_pending_settlement(locked)
        if locked.settlement_digest != swap.settlement_digest:
            raise SettlementContextChanged()
        submission = SwapApprovalSubmission.objects.filter(chain_id=terms["chain_id"], tx_hash=tx_hash).first()
        if submission is not None:
            return submission
        if SwapApprovalSubmission.objects.filter(
            chain_id=terms["chain_id"], sender_address=terms["sender_address"], nonce=decoded.nonce
        ).exists():
            raise SettlementApprovalConflict()
        party = context[participant]
        try:
            return SwapApprovalSubmission.objects.create(
                swap=locked,
                participant=participant,
                owner_account_id=party["owner_account_uuid"],
                wallet_id=party["wallet_uuid"],
                actor_id=actor_id,
                settlement_digest=locked.settlement_digest,
                nonce=decoded.nonce,
                tx_hash=tx_hash,
                raw_transaction=raw,
                intent=_intent(decoded),
                **terms,
            )
        except IntegrityError:
            raise SettlementApprovalConflict() from None


def _intent(decoded):
    return {
        "envelope_type": decoded.envelope_type,
        "to": decoded.to.lower(),
        "value": str(decoded.value),
        "data": "0x" + decoded.data.hex(),
        "gas_limit": str(decoded.gas_limit),
        "gas_price": str(decoded.gas_price) if decoded.gas_price is not None else None,
        "max_fee_per_gas": str(decoded.max_fee_per_gas) if decoded.max_fee_per_gas is not None else None,
        "max_priority_fee_per_gas": (
            str(decoded.max_priority_fee_per_gas) if decoded.max_priority_fee_per_gas is not None else None
        ),
    }


def attempt(submission_id, *, client=None, receipt_wait=0):
    submission = SwapApprovalSubmission.objects.filter(pk=submission_id).first()
    if submission is None:
        return "not_found"
    if submission.outcome != PENDING:
        return submission.outcome
    SwapApprovalSubmission.objects.filter(pk=submission.pk, outcome=PENDING).update(updated_at=timezone.now())
    raw = bytes(submission.raw_transaction)
    if not _identity_holds(submission, raw):
        return "identity_unavailable"
    try:
        client = client or get_base_chain_client()
        if client.w3.eth.chain_id != submission.chain_id:
            return "chain_unavailable"
        receipt = client.get_transaction_receipt(submission.tx_hash)
        if receipt is None and _mined_nonce(client, submission) > submission.nonce:
            receipt = client.get_transaction_receipt(submission.tx_hash)
            if receipt is None:
                return _resolve(submission, ApprovalSubmissionOutcome.SUPERSEDED)
        if receipt is None:
            delivery = _deliver(client, submission, raw)
            if not receipt_wait:
                return delivery
            receipt = client.receipt_even_if_reverted(submission.tx_hash, timeout=receipt_wait)
        return _record_receipt(submission, receipt)
    except Exception as exc:
        _note_error(submission, exc)
        return "delivery_unavailable"


def _identity_holds(submission, raw):
    try:
        decoded = decode_signed_transaction(raw)
    except ValueError:
        return False
    return (
        Web3.keccak(raw).to_0x_hex() == submission.tx_hash
        and decoded.chain_id == submission.chain_id
        and decoded.nonce == submission.nonce
        and decoded.sender.lower() == submission.sender_address
        and (decoded.to or "").lower() == submission.token_address
        and decoded.value == 0
        and decoded.data == approve_calldata(submission.spender_address)
    )


def _mined_nonce(client, submission):
    observed = client.w3.eth.get_transaction_count(Web3.to_checksum_address(submission.sender_address), "latest")
    nonce = nonnegative_integer(observed, maximum=2**64 - 1)
    if nonce is None:
        raise ValueError("Invalid nonce observation")
    return nonce


def _resend_permitted(submission):
    swap = SwapOrder.objects.filter(pk=submission.swap_id).first()
    if swap is None or swap.settlement_digest != submission.settlement_digest:
        return False
    try:
        context = require_pending_settlement(swap)
    except APIException:
        return False
    return party_terms(context, submission.participant) == {
        "chain_id": submission.chain_id,
        "sender_address": submission.sender_address,
        "token_address": submission.token_address,
        "spender_address": submission.spender_address,
    }


def _deliver(client, submission, raw):
    now = timezone.now()
    claimed = (
        SwapApprovalSubmission.objects.filter(pk=submission.pk, outcome=PENDING)
        .filter(
            Q(last_attempt_at__isnull=True)
            | Q(last_attempt_at__lte=now - timedelta(seconds=SWAP_APPROVAL_RESEND_SECONDS))
        )
        .update(last_attempt_at=now, updated_at=now)
    )
    if not claimed:
        return "observing"
    if not _resend_permitted(submission):
        return "held"
    try:
        acknowledged = client.send_raw_transaction(raw)
    except Exception as exc:
        _note_error(submission, exc)
        return "delivery_unavailable"
    if not transaction_hash_matches(acknowledged, submission.tx_hash):
        return "acknowledgement_unavailable"
    SwapApprovalSubmission.objects.filter(pk=submission.pk, acknowledged_at__isnull=True).update(
        acknowledged_at=timezone.now(), updated_at=timezone.now()
    )
    return "acknowledged"


def _record_receipt(submission, receipt):
    if not isinstance(receipt, Mapping) or not transaction_hash_matches(
        receipt.get("transactionHash"), submission.tx_hash
    ):
        return "receipt_identity_unavailable"
    status = receipt.get("status")
    block_number = nonnegative_integer(receipt.get("blockNumber"), maximum=MAX_RECEIPT_INTEGER)
    gas_used = nonnegative_integer(receipt.get("gasUsed"), maximum=MAX_RECEIPT_INTEGER)
    block_hash = normalized_hash(receipt.get("blockHash"))
    if type(status) is not int or status not in (0, 1) or None in (block_number, gas_used, block_hash):
        return "receipt_identity_unavailable"
    outcome = ApprovalSubmissionOutcome.CONFIRMED if status == 1 else ApprovalSubmissionOutcome.REVERTED
    return _resolve(
        submission,
        outcome,
        block_number=block_number,
        block_hash="0x" + block_hash,
        gas_used=gas_used,
        confirmed_at=timezone.now(),
    )


def _resolve(submission, outcome, **receipt):
    with atomic(durable=True):
        locked = SwapApprovalSubmission.objects.select_for_update().get(pk=submission.pk)
        if locked.outcome != PENDING:
            return locked.outcome
        SwapApprovalSubmission.objects.filter(pk=locked.pk).update(
            outcome=outcome, updated_at=timezone.now(), **receipt
        )
        return outcome


def _note_error(submission, exc):
    logger.warning("Swap approval submission %s remains unresolved: %s", submission.pk, type(exc).__name__)
    SwapApprovalSubmission.objects.filter(pk=submission.pk).update(
        last_error=type(exc).__name__[:100], updated_at=timezone.now()
    )
