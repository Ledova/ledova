from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from web3 import Web3

from companies.models import Company
from companies.services.administration import require_company_administration
from companies.services.authority_requests import _requester_principal
from shared.db import atomic, use_operator
from tokens.constants import REGISTER_INSTRUCTION_REVIEW_MAX_AGE
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterInstruction,
    RegisterInstructionKind,
    RequestStatus,
    ShareIssuanceRequest,
    ShareToken,
    SwapOrder,
    SwapOrderStatus,
)
from tokens.services.holder_identity import identity_at_allotment
from tokens.services.register_authority import register_command
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_inclusions import (
    _members,
    issue_covered,
    opened_by_import,
    record_completed_effects,
    transfer_covered,
)
from tokens.services.register_openings import (
    EVIDENCE_REFUSAL,
    SHARE_CLASS_NOT_FOUND,
    _authority_values,
    _check_decision,
    _completed_decision,
    _confirm,
    _replayed,
    _reviewer,
)
from whitelist.services.identity import profile_name

SALT = "tokens.register-instruction"
COMPANY_DOCUMENT_REMOVED = (
    "This instruction relied on a company document, which Ledova no longer keeps. Reject it: the company can submit "
    "a fresh instruction with its own uploaded evidence."
)
SOURCES = ("request", "settlement")
ITEMS = {
    RegisterInstructionKind.ISSUE: (
        ("request",),
        ("recipient",),
        "List each issuance request with its recipient wallet and whole number of shares.",
        "The instruction lists an issuance request more than once.",
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


def _check_on_chain(token):
    if opened_by_import(token.pk):
        raise ValidationError(
            "This share class was opened from an imported register and is not yet on chain, so it records no issue "
            "and takes no register instruction."
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
        request = requests.filter(pk=reference, token=token).first()
        if request is None:
            raise ValidationError(f"Issuance request {reference} is not a direct issue of this share class.")
        if request.status in AWAITING:
            raise ValidationError("New non-paid grants require the company's retained appointment and grant decision.")
        names = [request.recipient_name]
        state = _state(request, source, reference)
        recipient, amount = request.recipient_address, request.amount
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
    authority_evidence,
    kind,
    items,
    approving_director,
    authority_reference,
    reason,
):
    if not get_user_model().objects.filter(pk=actor.pk, is_active=True).exists():
        raise PermissionDenied("An active company owner must submit the register instruction.")
    try:
        operation_id, token_id, authority_evidence = (
            UUID(str(value)) for value in (operation_id, token_id, authority_evidence)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Register instruction references must be UUIDs.") from None
    if kind not in RegisterInstructionKind.values:
        raise ValidationError("A register instruction approves issues or transfers.")
    values = _authority_values("director_resolution", approving_director, authority_reference, reason)
    del values["authority"]
    normalized = _items(kind, items)
    with use_operator(), _requester_principal(actor.pk):
        company_id = (
            ShareToken.objects.filter(pk=token_id, company__owner=actor).values_list("company_id", flat=True).first()
        )
    if company_id is None:
        raise NotFound(SHARE_CLASS_NOT_FOUND)
    proposal = None
    try:
        with register_command(actor, company_id, "register_instruction_submit") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            token = ShareToken.objects.filter(pk=token_id, company=company).first()
            if token is None or company.owner_id != current_actor.pk:
                raise NotFound(SHARE_CLASS_NOT_FOUND)
            existing = _replayed(
                RegisterInstruction,
                operation_id,
                {
                    **values,
                    "token_id": token.pk,
                    "kind": kind,
                    "items": normalized,
                    "authority_evidence_id": authority_evidence,
                    "submitted_by_id": current_actor.pk,
                },
            )
            if existing:
                return existing
            require_company_administration(company, current_actor, profile, operator)
            _check_on_chain(token)
            _check_items(kind, normalized, token, values["approving_director"])
            evidence = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(evidence, RegisterEvidenceKind.AUTHORITY, company, current_actor, EVIDENCE_REFUSAL)
            proposal = RegisterInstruction(
                uuid=operation_id,
                company=company,
                token=token,
                kind=kind,
                items=normalized,
                authority_evidence=evidence,
                evidence_fingerprint=evidence.sha256,
                evidence_snapshot=evidence_snapshot(evidence),
                submitted_by=current_actor,
                **values,
            )
            proposal.file.save("authority.bin", ContentFile(raw), save=False)
            try:
                proposal.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return proposal
    except BaseException:
        if proposal is not None:
            discard(proposal.file)
        raise


def _check_evidence(proposal, company):
    if proposal.source_document is not None:
        raise ValidationError(COMPANY_DOCUMENT_REMOVED)
    evidence = RegisterEvidence.objects.filter(pk=proposal.authority_evidence_id).first()
    if (
        company.owner_id != proposal.submitted_by_id
        or evidence is None
        or evidence.company_id != company.pk
        or evidence.kind != RegisterEvidenceKind.AUTHORITY
        or evidence.uploaded_by_id != proposal.submitted_by_id
        or evidence.sha256 != proposal.evidence_fingerprint
        or evidence_snapshot(evidence) != proposal.evidence_snapshot
    ):
        raise ValidationError("The company or its authority evidence changed. Submit a fresh register instruction.")
    matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)


def _preview(proposal, reviewer):
    return {"proposal": str(proposal.pk), "reviewer": reviewer.pk, "evidence": proposal.evidence_fingerprint}


def prepare_instruction_review(*, proposal_id, reviewer):
    reviewer = _reviewer(reviewer, RegisterInstruction)
    proposal = RegisterInstruction.objects.select_related("company", "token").get(pk=proposal_id)
    if proposal.preparing_appointment_id is not None:
        raise ValidationError("This grant is decided by its current company appointee through the register API.")
    if proposal.status != "submitted":
        raise ValidationError("This register instruction already has a decision.")
    _check_evidence(proposal, proposal.company)
    _check_on_chain(proposal.token)
    rows = _check_items(proposal.kind, proposal.items, proposal.token, proposal.approving_director)
    return proposal, rows, signing.dumps(_preview(proposal, reviewer), salt=SALT)


def decide_instruction(*, proposal_id, reviewer, confirmation, decision, rejection_reason=""):
    reviewer = _reviewer(reviewer, RegisterInstruction)
    _check_decision(decision, rejection_reason)
    initial = RegisterInstruction.objects.get(pk=proposal_id)
    if initial.preparing_appointment_id is not None:
        raise ValidationError("This grant is decided by its current company appointee through the register API.")
    if initial.status != "submitted":
        return _completed_decision(initial, reviewer, decision, rejection_reason)
    with atomic():
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        token = ShareToken.objects.select_for_update().get(pk=initial.token_id)
        proposal = RegisterInstruction.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            return _completed_decision(proposal, reviewer, decision, rejection_reason)
        if decision == "apply":
            _confirm(confirmation, SALT, REGISTER_INSTRUCTION_REVIEW_MAX_AGE, _preview(proposal, reviewer))
            _check_evidence(proposal, company)
            _check_on_chain(token)
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
