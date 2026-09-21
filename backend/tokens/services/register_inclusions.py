from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from blockchain.models import TransactionStatus
from integrations.blockchain.receipts import nonnegative_integer, normalized_hash
from shared.db import APP_ALIAS, current_alias
from tokens.models import (
    IssuanceExecutionStatus,
    IssuanceStatus,
    RegisterCorrectionStatus,
    RegisterOpening,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareToken,
    SwapOrder,
    SwapOrderStatus,
)
from wallets.services.receipt_readers import MAX_BLOCK_NUMBER

UNOPENED = "unopened"
OPENING = "opening"
AFTER_OPENING = "after_opening"
ATTRIBUTION = "attribution"
ISSUE = "issue"
TRANSFER = "transfer"


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Register inclusion classification requires the operator connection.")


def _attribution(kind, source):
    return ValidationError(
        f"The completed {kind} {source} has no verified final chain inclusion. It requires operator attribution "
        "before a register boundary can represent or exclude it."
    )


def _inclusion(kind, source, receipt, tx_hash):
    height = nonnegative_integer((receipt or {}).get("block_number"), maximum=MAX_BLOCK_NUMBER)
    digest = normalized_hash((receipt or {}).get("block_hash"))
    transaction = normalized_hash(tx_hash)
    policy = (receipt or {}).get("policy")
    if height is None or digest is None or transaction is None or not isinstance(policy, dict):
        raise _attribution(kind, source)
    return {
        "kind": kind,
        "source": str(source),
        "transaction": transaction,
        "block_number": height,
        "block_hash": digest,
    }


def opening_boundary(token_id):
    _operator()
    opening = (
        RegisterOpening.objects.filter(token_id=token_id, status=RegisterCorrectionStatus.APPLIED)
        .exclude(applied_entry=None)
        .first()
    )
    return opening.boundary if opening is not None else None


def completed_inclusions(token_id):
    _operator()
    issuances = list(ShareIssuance.objects.filter(token_id=token_id, status=IssuanceStatus.COMPLETED))
    executions = {
        execution.issuance_id: execution
        for execution in ShareIssuanceExecution.objects.filter(
            token_id=token_id,
            status=IssuanceExecutionStatus.EXECUTED,
            issuance_id__in=[issuance.pk for issuance in issuances],
        ).select_related("transaction")
    }
    inclusions = []
    for issuance in issuances:
        execution = executions.get(issuance.pk)
        record = execution.transaction if execution is not None else None
        if record is None or record.status != TransactionStatus.CONFIRMED:
            raise _attribution(ISSUE, issuance.pk)
        inclusion = _inclusion(ISSUE, issuance.pk, execution.finalized_receipt, record.tx_hash)
        if (inclusion["block_number"], inclusion["block_hash"]) != (
            record.block_number,
            normalized_hash(record.block_hash),
        ):
            raise _attribution(ISSUE, issuance.pk)
        inclusions.append(inclusion)
    for swap in SwapOrder.objects.filter(share_token_id=token_id, status=SwapOrderStatus.COMPLETED):
        inclusions.append(_inclusion(TRANSFER, swap.pk, swap.finalized_receipt, swap.tx_hash))
    return sorted(inclusions, key=lambda inclusion: (inclusion["block_number"], inclusion["kind"], inclusion["source"]))


def _history(boundary):
    history = boundary.get("history")
    if not isinstance(history, list):
        return None
    entries = []
    for entry in history:
        if not isinstance(entry, dict) or set(entry) != {"block", "block_hash", "transaction"}:
            return None
        recorded = (
            normalized_hash(entry["transaction"]),
            nonnegative_integer(entry["block"], maximum=MAX_BLOCK_NUMBER),
            normalized_hash(entry["block_hash"]),
        )
        if None in recorded:
            return None
        entries.append(recorded)
    return entries


def classify_inclusion(boundary, inclusion):
    if boundary is None:
        return UNOPENED
    history = _history(boundary)
    if history is None:
        return ATTRIBUTION
    recorded = {(block, digest) for transaction, block, digest in history if transaction == inclusion["transaction"]}
    if inclusion["block_number"] > boundary["block"]["number"]:
        return ATTRIBUTION if recorded else AFTER_OPENING
    if recorded != {(inclusion["block_number"], inclusion["block_hash"])}:
        return ATTRIBUTION
    return OPENING


def unrepresented_inclusions(token_id, boundary):
    return [
        inclusion for inclusion in completed_inclusions(token_id) if classify_inclusion(boundary, inclusion) != OPENING
    ]


def assert_boundary_represents_completions(token_id, boundary):
    if _history(boundary) is None:
        raise ValidationError(
            "The captured boundary has no canonical transfer history, so it cannot show which completed effects it "
            "represents. Reject this opening and submit a fresh one."
        )
    unrepresented = unrepresented_inclusions(token_id, boundary)
    if unrepresented:
        first = unrepresented[0]
        detail = (
            f"was finally included in block {first['block_number']}, after the captured boundary block "
            f"{boundary['block']['number']}"
            if classify_inclusion(boundary, first) == AFTER_OPENING
            else f"is not in the captured boundary's canonical history at block {first['block_number']}"
        )
        raise ValidationError(
            f"The completed {first['kind']} {first['source']} {detail}, so this boundary does not represent it. "
            "Submit a fresh opening."
        )


def classified_inclusions(token_id):
    _operator()
    if not ShareToken.objects.filter(pk=token_id).exists():
        raise NotFound("Share class not found.")
    boundary = opening_boundary(token_id)
    return {
        "token": str(token_id),
        "boundary": None if boundary is None else {"block": boundary["block"], "policy": boundary["policy"]},
        "inclusions": [
            {**inclusion, "classification": classify_inclusion(boundary, inclusion)}
            for inclusion in completed_inclusions(token_id)
        ],
    }
