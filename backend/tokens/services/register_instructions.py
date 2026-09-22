from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from web3 import Web3

from companies.models import Company, CompanyDocument
from offerings.models import Subscription, SubscriptionStatus
from shared.db import atomic
from tokens.constants import REGISTER_INSTRUCTION_REVIEW_MAX_AGE
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterInstruction,
    RegisterInstructionKind,
    RequestStatus,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.services.holder_identity import identity_at_allotment
from tokens.services.register_inclusions import issue_covered, record_completed_effects
from tokens.services.register_openings import (
    _authority_values,
    _check_decision,
    _check_evidence,
    _completed_decision,
    _confirm,
    _replayed,
    _retain,
    _reviewer,
)

SALT = "tokens.register-instruction"
SOURCES = ("request", "subscription")
AWAITING = (RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW)
APPROVED = (RequestStatus.APPROVED, RequestStatus.EXECUTING, RequestStatus.EXECUTED, RequestStatus.FAILED)
APPROVE = "Awaiting approval: applying approves it"
ALLOT = "Awaiting allotment: applying lets staff allot it"
COVER = "Approved before register instructions: applying records it once complete"


def _source(item):
    return next((source, item[source]) for source in SOURCES if source in item)


def _items(items):
    normalized = []
    try:
        if not isinstance(items, list) or not items:
            raise ValueError
        for item in items:
            if (
                not isinstance(item, dict)
                or len(item) != 3
                or not isinstance(item.get("recipient"), str)
                or not Web3.is_address(item["recipient"])
                or not isinstance(item.get("amount"), str)
                or not item["amount"].isdigit()
                or int(item["amount"]) < 1
            ):
                raise ValueError
            source, reference = _source(item)
            normalized.append(
                {
                    source: str(UUID(str(reference))),
                    "recipient": Web3.to_checksum_address(item["recipient"]),
                    "amount": str(int(item["amount"])),
                }
            )
    except (ValueError, TypeError, AttributeError, StopIteration):
        raise ValidationError(
            "List each issuance request or subscription with its recipient wallet and whole number of shares."
        ) from None
    if len({_source(item) for item in normalized}) != len(normalized):
        raise ValidationError("The instruction lists an issuance request or subscription more than once.")
    return sorted(normalized, key=_source)


def _named(name):
    return " ".join(name.split()).casefold()


def _recorded(request):
    return (
        request.executed_issuance_id is not None
        and RegisterEntry.objects.filter(
            kind=RegisterEntryKind.ISSUE, operation_id=request.executed_issuance_id
        ).exists()
    )


def _state(request, source, reference):
    if request.status in AWAITING and source == "request":
        return APPROVE
    if request.status in APPROVED and not issue_covered(request) and not _recorded(request):
        return COVER
    raise ValidationError(
        f"The {source} {reference} is neither awaiting approval nor an earlier approval whose issue is still to be "
        "recorded."
    )


def _check_items(items, token, director, *, lock=False):
    requests = ShareIssuanceRequest.objects.select_for_update() if lock else ShareIssuanceRequest.objects
    rows = []
    for item in items:
        source, reference = _source(item)
        if source == "request":
            request = requests.filter(pk=reference, token=token).first()
            if request is None or Subscription.objects.filter(issuance_request_id=reference).exists():
                raise ValidationError(
                    f"Issuance request {reference} is not a direct issue of this share class. List an allotment by "
                    "its subscription."
                )
            names = [request.recipient_name]
        else:
            subscription = Subscription.objects.filter(pk=reference, offering__token=token).first()
            if subscription is None:
                raise ValidationError(f"Subscription {reference} is not in an offering of this share class.")
            request = requests.filter(pk=subscription.issuance_request_id).first()
            if request is None and (
                subscription.status != SubscriptionStatus.PAID or subscription.allotment_quantity < 1
            ):
                raise ValidationError(f"Subscription {reference} is not paid and awaiting allotment.")
            names = []
        state = ALLOT if request is None else _state(request, source, reference)
        recipient, amount = (
            (subscription.wallet.address, subscription.allotment_quantity)
            if request is None
            else (request.recipient_address, request.amount)
        )
        if (Web3.to_checksum_address(recipient), str(amount)) != (item["recipient"], item["amount"]):
            raise ValidationError(
                f"The recipient or number of shares of {source} {reference} differs from the instruction. Submit a "
                "fresh instruction with its current terms."
            )
        names = [name for name in [*names, identity_at_allotment(recipient, chain=token.chain).name] if name.strip()]
        if _named(director) in {_named(name) for name in names}:
            raise ValidationError(
                f"The approving director is the recipient of {source} {reference}. Another director must approve it."
            )
        rows.append(
            {**item, "source": source, "reference": reference, "names": names, "state": state, "instance": request}
        )
    return rows


def submit_instruction(
    *,
    actor,
    operation_id,
    token_id,
    document_id,
    kind,
    items,
    approving_director,
    authority_reference,
    reason,
):
    if not get_user_model().objects.filter(pk=actor.pk, is_active=True).exists():
        raise PermissionDenied("An active company owner must submit the register instruction.")
    try:
        operation_id, token_id, document_id = (UUID(str(value)) for value in (operation_id, token_id, document_id))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Register instruction references must be UUIDs.") from None
    if kind != RegisterInstructionKind.ISSUE:
        raise ValidationError("A register instruction approves issues.")
    values = _authority_values("director_resolution", approving_director, authority_reference, reason)
    del values["authority"]
    normalized = _items(items)
    with atomic():
        token = ShareToken.objects.filter(pk=token_id, company__owner=actor).first()
        if token is None:
            raise NotFound("Share class not found.")
        company = Company.objects.select_for_update(no_key=True).filter(pk=token.company_id, owner=actor).first()
        if company is None:
            raise NotFound("Share class not found.")
        existing = _replayed(
            RegisterInstruction,
            operation_id,
            {
                **values,
                "token_id": token.pk,
                "kind": kind,
                "items": normalized,
                "source_document": document_id,
                "submitted_by_id": actor.pk,
            },
        )
        if existing:
            return existing
        _check_items(normalized, token, values["approving_director"])
        return _retain(
            RegisterInstruction(uuid=operation_id, company=company, token=token, kind=kind, items=normalized, **values),
            document_id,
            actor,
        )


def _preview(proposal, reviewer):
    return {"proposal": str(proposal.pk), "reviewer": reviewer.pk, "evidence": proposal.evidence_fingerprint}


def prepare_instruction_review(*, proposal_id, reviewer):
    reviewer = _reviewer(reviewer, RegisterInstruction)
    proposal = RegisterInstruction.objects.select_related("company", "token").get(pk=proposal_id)
    if proposal.status != "submitted":
        raise ValidationError("This register instruction already has a decision.")
    _check_evidence(proposal, proposal.company, CompanyDocument.objects.filter(pk=proposal.source_document).first())
    rows = _check_items(proposal.items, proposal.token, proposal.approving_director)
    return proposal, rows, signing.dumps(_preview(proposal, reviewer), salt=SALT)


def decide_instruction(*, proposal_id, reviewer, confirmation, decision, rejection_reason=""):
    reviewer = _reviewer(reviewer, RegisterInstruction)
    _check_decision(decision, rejection_reason)
    initial = RegisterInstruction.objects.get(pk=proposal_id)
    if initial.status != "submitted":
        return _completed_decision(initial, reviewer, decision, rejection_reason)
    with atomic():
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        token = ShareToken.objects.select_for_update().get(pk=initial.token_id)
        document = CompanyDocument.objects.select_for_update().filter(pk=initial.source_document).first()
        proposal = RegisterInstruction.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            return _completed_decision(proposal, reviewer, decision, rejection_reason)
        if decision == "apply":
            _confirm(confirmation, SALT, REGISTER_INSTRUCTION_REVIEW_MAX_AGE, _preview(proposal, reviewer))
            _check_evidence(proposal, company, document)
            for row in _check_items(proposal.items, token, proposal.approving_director, lock=True):
                if row["state"] == APPROVE:
                    row["instance"].approve(reviewer, f"Approved by register instruction {proposal.pk}.")
            proposal.status = "applied"
        else:
            proposal.status = "rejected"
            proposal.rejection_reason = rejection_reason
        proposal.reviewed_by = reviewer
        proposal.reviewed_at = timezone.now()
        proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
        if proposal.status == "applied":
            record_completed_effects(token.pk)
        return proposal
