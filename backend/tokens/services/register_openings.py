import hashlib
from collections import defaultdict
from collections.abc import Mapping
from datetime import date
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from web3 import Web3

from companies.models import Company, CompanyDocument
from companies.services.document_review import (
    document_fingerprint,
    private_document_bytes,
    verified_document_snapshot,
)
from integrations.base_chain import get_base_chain_client
from integrations.blockchain.receipts import normalized_hash
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.constants import REGISTER_OPENING_REVIEW_MAX_AGE
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_snapshot import capture_snapshot
from wallets.services.chain_observations import finality_policy


def _mapping(mapping):
    if not isinstance(mapping, list):
        raise ValidationError("The opening mapping must be a list of wallet addresses and member IDs.")
    normalized = []
    try:
        for link in mapping:
            if not isinstance(link, dict) or set(link) != {"address", "member"}:
                raise ValueError
            if not isinstance(link["address"], str) or not Web3.is_address(link["address"]):
                raise ValueError
            normalized.append(
                {"address": Web3.to_checksum_address(link["address"]), "member": str(UUID(str(link["member"])))}
            )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("The opening mapping requires wallet addresses and member UUIDs.") from None
    if len({link["address"].lower() for link in normalized}) != len(normalized):
        raise ValidationError("The opening mapping repeats a wallet address.")
    return sorted(normalized, key=lambda link: link["address"])


def _authority_values(authority, approving_director, authority_reference, reason):
    values = {
        "authority": authority,
        "approving_director": approving_director,
        "authority_reference": authority_reference,
        "reason": reason,
    }
    if (
        authority not in ("director_resolution", "court_order")
        or any(not isinstance(value, str) for value in values.values())
        or not authority_reference.strip()
        or not reason.strip()
        or len(authority_reference) > 255
        or len(reason) > 1000
        or len(approving_director) > 255
        or (authority == "director_resolution") != bool(approving_director.strip())
    ):
        raise ValidationError(
            "Name the approving director for a resolution, or supply a court order, with a reference and reason."
        )
    return values


def submit_opening(
    *,
    actor,
    operation_id,
    token_id,
    document_id,
    mapping,
    authority,
    approving_director,
    authority_reference,
    reason,
):
    if not get_user_model().objects.filter(pk=actor.pk, is_active=True).exists():
        raise PermissionDenied("An active company owner must submit the opening.")
    try:
        operation_id, token_id, document_id = (UUID(str(value)) for value in (operation_id, token_id, document_id))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Opening references must be UUIDs.") from None
    values = _authority_values(authority, approving_director, authority_reference, reason)
    normalized = _mapping(mapping)
    with atomic():
        token = ShareToken.objects.select_for_update().filter(pk=token_id, company__owner=actor).first()
        if token is None:
            raise NotFound("Share class not found.")
        company = Company.objects.select_for_update(no_key=True).get(pk=token.company_id)
        if company.owner_id != actor.pk:
            raise NotFound("Share class not found.")
        existing = RegisterOpening.objects.filter(pk=operation_id).first()
        if existing:
            expected = {
                **values,
                "token_id": token_id,
                "mapping": normalized,
                "source_document": document_id,
                "submitted_by_id": actor.pk,
            }
            if any(getattr(existing, key) != value for key, value in expected.items()):
                raise RegisterChangeConflict()
            return existing
        if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED):
            raise ValidationError("A register opening requires a deployed share class.")
        register = ShareRegister.objects.filter(token=token).first()
        if register is not None and RegisterEntry.objects.filter(register=register).exists():
            raise ValidationError("This share class already has a stored register.")
        members = [UUID(link["member"]) for link in normalized]
        if RegisterMember.objects.filter(uuid__in=members).exclude(company=company).exists():
            raise ValidationError("Mapped members must belong to this company.")
        addresses = [link["address"] for link in normalized]
        for link in RegisterMemberWallet.objects.filter(company=company, address__in=addresses).select_related(
            "member"
        ):
            expected_member = next(item["member"] for item in normalized if item["address"] == link.address)
            if str(link.member_id) != expected_member:
                raise ValidationError("A mapped wallet address already belongs to another member of this company.")
        document = CompanyDocument.objects.select_for_update().filter(pk=document_id, company=company).first()
        if document is None:
            raise NotFound("Company authority document not found.")
        document.company = company
        raw = private_document_bytes(document.file)
        snapshot = verified_document_snapshot(document, content=ContentFile(raw))
        proposal = RegisterOpening(
            uuid=operation_id,
            company=company,
            token=token,
            mapping=normalized,
            source_document=document.pk,
            evidence_fingerprint=document.verified_fingerprint,
            evidence_snapshot=snapshot,
            submitted_by=actor,
            **values,
        )
        proposal.file.save("authority.bin", ContentFile(raw), save=False)
        try:
            proposal.save(force_insert=True)
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return proposal


def _reviewer(user):
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Register opening review requires the operator connection.")
    reviewer = get_user_model().objects.get(pk=user.pk)
    if not reviewer.is_active or not reviewer.is_staff or not reviewer.has_perm("tokens.change_registeropening"):
        raise PermissionDenied("Register opening review requires an authorised staff reviewer.")
    return reviewer


def _check_evidence(proposal, company, document):
    if company.owner_id != proposal.submitted_by_id or document is None or document.company_id != company.pk:
        raise ValidationError("The company or its authority document changed. Submit a fresh opening.")
    document.company = company
    if verified_document_snapshot(document) != proposal.evidence_snapshot or (
        document_fingerprint(document) != proposal.evidence_fingerprint
    ):
        raise ValidationError("The authority evidence changed. Submit a fresh opening.")
    raw = private_document_bytes(proposal.file)
    if (
        hashlib.sha256(raw).hexdigest() != proposal.evidence_snapshot["sha256"]
        or len(raw) != proposal.evidence_snapshot["file_size"]
        or document_fingerprint(document, content=ContentFile(raw)) != proposal.evidence_fingerprint
    ):
        raise ValidationError("The retained authority evidence no longer matches the proposal.")


def _check_mapping_against_boundary(mapping, boundary):
    mapped = {link["address"].lower() for link in mapping}
    holding = {row["address"].lower() for row in boundary["holdings"]}
    if mapped != holding:
        raise ValidationError(
            "The opening mapping must cover exactly the wallet addresses holding shares at the captured boundary."
        )


def _recheck_boundary(boundary, *, client=None):
    client = client or get_base_chain_client()
    if client.assert_expected_chain() != boundary["chain_id"]:
        raise ValidationError("The captured boundary is not on the share class's original deployment chain.")
    if finality_policy(f"evm:{boundary['chain_id']}", BLOCKCHAIN_BASE) != boundary["policy"]:
        raise ValidationError("The approved finality policy changed since the boundary was captured.")
    block = client.w3.eth.get_block(boundary["block"]["number"])
    block_hash = normalized_hash(block.get("hash")) if isinstance(block, Mapping) else None
    if block_hash is None or f"0x{block_hash}" != boundary["block"]["hash"]:
        raise ValidationError("The captured boundary block is no longer canonical.")


def _check_uninitialized(token):
    register, _ = ShareRegister.objects.get_or_create(token=token, defaults={"company_id": token.company_id})
    if RegisterEntry.objects.filter(register=register).exists():
        raise ValidationError("This share class already has a stored register.")
    return register


def _opening_changes(proposal):
    member_of = {link["address"].lower(): link["member"] for link in proposal.mapping}
    shares_by_member = defaultdict(int)
    for row in proposal.boundary["holdings"]:
        shares_by_member[member_of[row["address"].lower()]] += int(row["shares"])
    return [{"member": member, "shares": str(shares)} for member, shares in sorted(shares_by_member.items())]


def prepare_opening_review(*, proposal_id, reviewer, client=None):
    reviewer = _reviewer(reviewer)
    proposal = RegisterOpening.objects.select_related("company", "token").get(pk=proposal_id)
    if proposal.status != "submitted":
        raise ValidationError("This opening already has a decision.")
    document = CompanyDocument.objects.filter(pk=proposal.source_document).first()
    _check_evidence(proposal, proposal.company, document)
    _check_uninitialized(proposal.token)
    if proposal.boundary is None:
        boundary = capture_snapshot(proposal.token_id, client=client)
        _check_mapping_against_boundary(proposal.mapping, boundary)
        with atomic():
            current = RegisterOpening.objects.select_for_update().get(pk=proposal_id)
            if current.status != "submitted" or current.boundary is not None:
                raise RegisterChangeConflict()
            current.boundary = boundary
            current.save(update_fields=["boundary", "updated_at"])
            proposal = current
    else:
        _recheck_boundary(proposal.boundary, client=client)
        _check_mapping_against_boundary(proposal.mapping, proposal.boundary)
    confirmation = signing.dumps(
        {
            "proposal": str(proposal.pk),
            "reviewer": reviewer.pk,
            "evidence": proposal.evidence_fingerprint,
            "boundary": proposal.boundary["block"]["hash"],
        },
        salt="tokens.register-opening",
    )
    return proposal, confirmation


def decide_opening(*, proposal_id, reviewer, confirmation, decision, rejection_reason="", client=None):
    reviewer = _reviewer(reviewer)
    if (
        decision not in ("apply", "reject")
        or (decision == "reject" and not rejection_reason.strip())
        or len(rejection_reason) > 1000
    ):
        raise ValidationError("Choose application or rejection with a reason.")
    initial = RegisterOpening.objects.get(pk=proposal_id)
    if decision == "apply":
        if initial.boundary is None:
            raise ValidationError("Open a review before applying this opening.")
        _recheck_boundary(initial.boundary, client=client)
    with atomic():
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        token = ShareToken.objects.select_for_update().get(pk=initial.token_id)
        document = CompanyDocument.objects.select_for_update().filter(pk=initial.source_document).first()
        proposal = RegisterOpening.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            if proposal.reviewed_by_id == reviewer.pk and (
                (decision == "apply" and proposal.status == "applied")
                or (
                    decision == "reject"
                    and proposal.status == "rejected"
                    and proposal.rejection_reason == rejection_reason
                )
            ):
                return proposal
            raise RegisterChangeConflict()
        if decision == "apply":
            try:
                preview = signing.loads(
                    confirmation, salt="tokens.register-opening", max_age=REGISTER_OPENING_REVIEW_MAX_AGE
                )
            except signing.BadSignature:
                raise ValidationError("The review confirmation is invalid or expired. Open a fresh review.") from None
            if (
                preview.get("proposal") != str(proposal_id)
                or preview.get("reviewer") != reviewer.pk
                or preview.get("evidence") != proposal.evidence_fingerprint
                or preview.get("boundary") != proposal.boundary["block"]["hash"]
            ):
                raise ValidationError("The confirmation belongs to another proposal, reviewer, evidence or boundary.")
            _check_evidence(proposal, company, document)
            register = _check_uninitialized(token)
            for link in proposal.mapping:
                create_member(company_id=company.pk, member_id=UUID(link["member"]))
                wallet, created = RegisterMemberWallet.objects.get_or_create(
                    company=company,
                    address=link["address"],
                    defaults={"member_id": UUID(link["member"])},
                )
                if not created and str(wallet.member_id) != link["member"]:
                    raise RegisterChangeConflict()
            proposal.applied_entry = record_entry(
                register_id=register.pk,
                operation_id=proposal.pk,
                kind=RegisterEntryKind.OPENING,
                changes=_opening_changes(proposal),
                effective_on=date.fromisoformat(proposal.boundary["block"]["date"]),
                recorded_by=reviewer,
            )
            proposal.status = "applied"
        else:
            proposal.status = "rejected"
            proposal.rejection_reason = rejection_reason
        proposal.reviewed_by = reviewer
        proposal.reviewed_at = timezone.now()
        proposal.save(
            update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "applied_entry", "updated_at"]
        )
        return proposal
