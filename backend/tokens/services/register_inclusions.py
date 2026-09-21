import logging
from datetime import timezone as utc_zone
from uuid import UUID

from django.db import DatabaseError
from django.db.models.functions import Lower
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from blockchain.models import TransactionStatus
from integrations.blockchain.receipts import nonnegative_integer, normalized_hash
from offerings.models import Subscription
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    IssuanceExecutionStatus,
    IssuanceStatus,
    RegisterCorrectionStatus,
    RegisterEntry,
    RegisterEntryKind,
    RegisterInstruction,
    RegisterMemberWallet,
    RegisterOpening,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
    SwapOrder,
    SwapOrderStatus,
)
from tokens.services.register_events import record_entry
from wallets.services.nonce_evidence import MAX_BLOCK_TRANSACTIONS
from wallets.services.receipt_readers import MAX_BLOCK_NUMBER

logger = logging.getLogger(__name__)

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
        "transaction_index": nonnegative_integer(
            (receipt or {}).get("transaction_index"), maximum=MAX_BLOCK_TRANSACTIONS
        ),
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
    return sorted(inclusions, key=chain_order)


def chain_order(inclusion):
    index = inclusion["transaction_index"]
    return (inclusion["block_number"], index is None, index or 0, inclusion["kind"], inclusion["source"])


def _history(boundary):
    history = boundary.get("history")
    if not isinstance(history, list):
        return None
    anchors = {
        boundary.get("deployment_block"): normalized_hash(boundary.get("deployment_hash")),
        boundary["block"]["number"]: normalized_hash(boundary["block"]["hash"]),
    }
    entries = []
    for entry in history:
        if not isinstance(entry, dict) or set(entry) != {"block", "block_hash", "transaction"}:
            return None
        transaction, block, digest = (
            normalized_hash(entry["transaction"]),
            nonnegative_integer(entry["block"], maximum=MAX_BLOCK_NUMBER),
            normalized_hash(entry["block_hash"]),
        )
        if None in (transaction, block, digest) or anchors.get(block, digest) != digest:
            return None
        entries.append((transaction, block, digest))
    return entries


def classifier(boundary):
    if boundary is None:
        return lambda inclusion: UNOPENED
    history = _history(boundary)
    if history is None:
        return lambda inclusion: ATTRIBUTION
    blocks = {}
    for transaction, block, digest in history:
        blocks.setdefault(transaction, set()).add((block, digest))
    height = boundary["block"]["number"]

    def classify(inclusion):
        recorded = blocks.get(inclusion["transaction"], set())
        if inclusion["block_number"] > height:
            return ATTRIBUTION if recorded else AFTER_OPENING
        if recorded != {(inclusion["block_number"], inclusion["block_hash"])}:
            return ATTRIBUTION
        return OPENING

    return classify


def classify_inclusion(boundary, inclusion):
    return classifier(boundary)(inclusion)


def unrepresented_inclusions(token_id, boundary):
    classify = classifier(boundary)
    return [inclusion for inclusion in completed_inclusions(token_id) if classify(inclusion) != OPENING]


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


def _recorded(token_id):
    return {
        str(operation)
        for operation in RegisterEntry.objects.filter(
            register__token_id=token_id, kind__in=[RegisterEntryKind.ISSUE, RegisterEntryKind.TRANSFER]
        ).values_list("operation_id", flat=True)
    }


def classified_inclusions(token_id):
    _operator()
    if not ShareToken.objects.filter(pk=token_id).exists():
        raise NotFound("Share class not found.")
    boundary = opening_boundary(token_id)
    classify = classifier(boundary)
    recorded = _recorded(token_id)
    return {
        "token": str(token_id),
        "boundary": None if boundary is None else {"block": boundary["block"], "policy": boundary["policy"]},
        "inclusions": [
            {
                **inclusion,
                "classification": classify(inclusion),
                "recorded": inclusion["source"] in recorded,
            }
            for inclusion in completed_inclusions(token_id)
        ],
    }


def _members(company_id, addresses):
    return {
        link.address_lower: str(link.member_id)
        for link in RegisterMemberWallet.objects.filter(company_id=company_id)
        .annotate(address_lower=Lower("address"))
        .filter(address_lower__in=[address.lower() for address in addresses])
    }


def issue_covered(request):
    subscription = Subscription.objects.filter(issuance_request=request).values_list("pk", flat=True).first()
    listed = [{"request": str(request.pk)}, *([{"subscription": str(subscription)}] if subscription else [])]
    return RegisterInstruction.objects.covering(*listed).exists()


def _effect(inclusion, company_id):
    if inclusion["kind"] == ISSUE:
        issuance = ShareIssuance.objects.get(pk=inclusion["source"])
        request = ShareIssuanceRequest.objects.filter(executed_issuance=issuance).select_related("reviewed_by").first()
        member = _members(company_id, [issuance.recipient_address]).get(issuance.recipient_address.lower())
        if member is None or request is None or request.reviewed_by is None or not issue_covered(request):
            return None
        return {
            "kind": RegisterEntryKind.ISSUE,
            "changes": [{"member": member, "shares": str(int(issuance.amount))}],
            "effective_on": issuance.completed_at.astimezone(utc_zone.utc).date(),
            "recorded_by": request.reviewed_by,
        }
    swap = SwapOrder.objects.select_related("seller_wallet__user_account__user_profile__user").get(
        pk=inclusion["source"]
    )
    members = _members(company_id, [swap.seller_address, swap.buyer_address])
    seller, buyer = members.get(swap.seller_address.lower()), members.get(swap.buyer_address.lower())
    if seller is None or buyer is None:
        return None
    if seller == buyer:
        return {}
    return {
        "kind": RegisterEntryKind.TRANSFER,
        "changes": sorted(
            [
                {"member": seller, "shares": str(-swap.share_amount)},
                {"member": buyer, "shares": str(swap.share_amount)},
            ],
            key=lambda change: change["member"],
        ),
        "effective_on": swap.completed_at.astimezone(utc_zone.utc).date(),
        "recorded_by": swap.seller_wallet.user_account.user_profile.user,
    }


def record_completed_effects(token_id):
    _operator()
    boundary = opening_boundary(token_id)
    register = ShareRegister.objects.filter(token_id=token_id).select_related("token").first()
    if boundary is None or register is None:
        return []
    try:
        inclusions = completed_inclusions(token_id)
    except ValidationError:
        logger.warning("Register recording for share class %s waits for attribution of a completed effect", token_id)
        return []
    classify = classifier(boundary)
    recorded = _recorded(token_id)
    appended = []
    for inclusion in inclusions:
        classification = classify(inclusion)
        if classification == OPENING or inclusion["source"] in recorded:
            continue
        effect = _effect(inclusion, register.token.company_id) if classification == AFTER_OPENING else None
        if effect == {}:
            continue
        if effect is None:
            logger.info(
                "Register recording for share class %s waits at %s %s (%s)",
                token_id,
                inclusion["kind"],
                inclusion["source"],
                classification,
            )
            return appended
        try:
            with atomic():
                appended.append(record_entry(register_id=register.pk, operation_id=UUID(inclusion["source"]), **effect))
        except (ValidationError, RegisterChangeConflict, DatabaseError):
            logger.warning(
                "The register refused %s %s for share class %s; later effects wait",
                inclusion["kind"],
                inclusion["source"],
                token_id,
            )
            return appended
    return appended


def waiting_effects(token_id):
    _operator()
    boundary = opening_boundary(token_id)
    register = ShareRegister.objects.filter(token_id=token_id).select_related("token").first()
    if boundary is None or register is None:
        return None
    try:
        inclusions = completed_inclusions(token_id)
    except ValidationError:
        return None
    classify = classifier(boundary)
    recorded = _recorded(token_id)
    waiting = 0
    for inclusion in inclusions:
        classification = classify(inclusion)
        if classification == OPENING or inclusion["source"] in recorded:
            continue
        if classification == AFTER_OPENING and _effect(inclusion, register.token.company_id) == {}:
            continue
        waiting += 1
    return waiting
