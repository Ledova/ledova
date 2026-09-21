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
ISSUE = "issue"
TRANSFER = "transfer"


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Register inclusion classification requires the operator connection.")


def _attribution(kind, source):
    return ValidationError(
        f"The completed {kind} {source} has no verified final chain inclusion. It requires operator attribution "
        "before its share class can record a register boundary."
    )


def _inclusion(kind, source, block_number, block_hash):
    height = nonnegative_integer(block_number, maximum=MAX_BLOCK_NUMBER)
    digest = normalized_hash(block_hash)
    if height is None or digest is None:
        raise _attribution(kind, source)
    return {"kind": kind, "source": str(source), "block_number": height, "block_hash": digest}


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
        inclusions.append(_inclusion(ISSUE, issuance.pk, record.block_number, record.block_hash))
    for swap in SwapOrder.objects.filter(share_token_id=token_id, status=SwapOrderStatus.COMPLETED):
        receipt = swap.finalized_receipt if isinstance(swap.finalized_receipt, dict) else {}
        inclusions.append(_inclusion(TRANSFER, swap.pk, receipt.get("block_number"), receipt.get("block_hash")))
    return sorted(inclusions, key=lambda inclusion: (inclusion["block_number"], inclusion["kind"], inclusion["source"]))


def classify_inclusion(boundary, inclusion):
    if boundary is None:
        return UNOPENED
    block = boundary["block"]
    if inclusion["block_number"] > block["number"]:
        return AFTER_OPENING
    if inclusion["block_number"] == block["number"] and inclusion["block_hash"] != normalized_hash(block["hash"]):
        raise ValidationError(
            f"The completed {inclusion['kind']} {inclusion['source']} was finally included in another block "
            f"{block['number']} than the captured boundary. Submit a fresh opening."
        )
    return OPENING


def unrepresented_inclusions(token_id, boundary):
    return [
        inclusion
        for inclusion in completed_inclusions(token_id)
        if classify_inclusion(boundary, inclusion) == AFTER_OPENING
    ]


def assert_boundary_represents_completions(token_id, boundary):
    unrepresented = unrepresented_inclusions(token_id, boundary)
    if unrepresented:
        first = unrepresented[0]
        raise ValidationError(
            f"The completed {first['kind']} {first['source']} was finally included in block {first['block_number']}, "
            f"after the captured boundary block {boundary['block']['number']}, so this boundary does not represent "
            "it. Submit a fresh opening."
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
