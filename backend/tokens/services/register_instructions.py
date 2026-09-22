from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from web3 import Web3

from companies.models import Company, CompanyDocument
from offerings.models import Subscription, SubscriptionStatus
from shared.db import atomic, use_operator
from tokens.constants import REGISTER_INSTRUCTION_REVIEW_MAX_AGE
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterInstruction,
    RegisterInstructionKind,
    RequestStatus,
    ShareIssuanceRequest,
    ShareToken,
    SwapOrder,
    SwapOrderStatus,
)
from tokens.services.holder_identity import identity_at_allotment
from tokens.services.register_inclusions import (
    _members,
    issue_covered,
    record_completed_effects,
    transfer_covered,
)
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
from whitelist.services.identity import profile_name

SALT = "tokens.register-instruction"
SOURCES = ("request", "subscription", "settlement")
ITEMS = {
    RegisterInstructionKind.ISSUE: (
        ("request", "subscription"),
        ("recipient",),
        "List each issuance request or subscription with its recipient wallet and whole number of shares.",
        "The instruction lists an issuance request or subscription more than once.",
    ),
    RegisterInstructionKind.TRANSFER: (
        ("settlement",),
        ("seller", "buyer"),
        "List each settlement with its seller and buyer wallets and whole number of shares.",
        "The instruction lists a settlement more than once.",
    ),
}
AWAITING = (RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW)
APPROVED = (RequestStatus.APPROVED, RequestStatus.EXECUTING, RequestStatus.EXECUTED, RequestStatus.FAILED)
APPROVE = "Awaiting approval: applying approves it"
ALLOT = "Awaiting allotment: applying lets staff allot it"
COVER = "Approved before register instructions: applying records it once complete"
SETTLED = "Settled and waiting: applying lets the register record its transfer"


def _source(item):
    return next((source, item[source]) for source in SOURCES if source in item)


def _items(kind, items):
    sources, parties, malformed, repeated = ITEMS[kind]
    normalized = []
    try:
        if not isinstance(items, list) or not items:
            raise ValueError
        for item in items:
            if (
                not isinstance(item, dict)
                or len(item) != len(parties) + 2
                or not all(isinstance(item.get(party), str) and Web3.is_address(item[party]) for party in parties)
                or not isinstance(item.get("amount"), str)
                or not item["amount"].isdigit()
                or int(item["amount"]) < 1
            ):
                raise ValueError
            source = next(source for source in sources if source in item)
            normalized.append(
                {
                    source: str(UUID(str(item[source]))),
                    **{party: Web3.to_checksum_address(item[party]) for party in parties},
                    "amount": str(int(item["amount"])),
                }
            )
    except (ValueError, TypeError, AttributeError, StopIteration):
        raise ValidationError(malformed) from None
    if len({_source(item) for item in normalized}) != len(normalized):
        raise ValidationError(repeated)
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


def _check_settlements(items, token, director):
    rows = []
    with use_operator():
        for item in items:
            reference = item["settlement"]
            swap = SwapOrder.objects.filter(pk=reference, share_token=token, status=SwapOrderStatus.COMPLETED).first()
            if swap is None:
                raise ValidationError(f"Settlement {reference} is not a completed settlement of this share class.")
            parties = [Web3.to_checksum_address(address) for address in (swap.seller_address, swap.buyer_address)]
            if (*parties, str(swap.share_amount)) != (item["seller"], item["buyer"], item["amount"]):
                raise ValidationError(
                    f"The seller, buyer or number of shares of settlement {reference} differs from the instruction."
                )
            if (
                transfer_covered(swap)
                or RegisterEntry.objects.filter(kind=RegisterEntryKind.TRANSFER, operation_id=swap.pk).exists()
            ):
                raise ValidationError(
                    f"Settlement {reference} is already covered by an applied instruction or entered in the register."
                )
            names = [
                profile_name(wallet.user_account.user_profile) for wallet in (swap.seller_wallet, swap.buyer_wallet)
            ]
            if _named(director) in {_named(name) for name in names}:
                raise ValidationError(
                    f"The approving director is a party to settlement {reference}. Another director must approve it."
                )
            members = _members(token.company_id, parties)
            rows.append(
                {
                    **item,
                    "seller_member": members.get(parties[0].lower(), ""),
                    "seller_name": names[0],
                    "buyer_member": members.get(parties[1].lower(), ""),
                    "buyer_name": names[1],
                    "completed_at": swap.completed_at,
                    "state": SETTLED,
                }
            )
    return rows


def _check_items(kind, items, token, director, *, lock=False):
    if kind == RegisterInstructionKind.TRANSFER:
        return _check_settlements(items, token, director)
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
    if kind not in RegisterInstructionKind.values:
        raise ValidationError("A register instruction approves issues or transfers.")
    values = _authority_values("director_resolution", approving_director, authority_reference, reason)
    del values["authority"]
    normalized = _items(kind, items)
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
        _check_items(kind, normalized, token, values["approving_director"])
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
    rows = _check_items(proposal.kind, proposal.items, proposal.token, proposal.approving_director)
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
            for row in _check_items(proposal.kind, proposal.items, token, proposal.approving_director, lock=True):
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
