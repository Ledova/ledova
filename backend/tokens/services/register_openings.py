import hashlib
from collections import defaultdict
from collections.abc import Mapping
from datetime import date
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.db.models.functions import Lower
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
from tokens.constants import (
    REGISTER_LINK_REVIEW_MAX_AGE,
    REGISTER_OPENING_REVIEW_MAX_AGE,
)
from tokens.exceptions import RegisterChangeConflict, RegisterUnavailableException
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterWalletLink,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_inclusions import assert_boundary_represents_completions
from tokens.services.register_snapshot import _boundary, capture_snapshot
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
        token = ShareToken.objects.filter(pk=token_id, company__owner=actor).first()
        if token is None:
            raise NotFound("Share class not found.")
        company = Company.objects.select_for_update(no_key=True).get(pk=token.company_id)
        if company.owner_id != actor.pk:
            raise NotFound("Share class not found.")
        token = ShareToken.objects.select_for_update().get(pk=token_id)
        if token.company_id != company.pk:
            raise NotFound("Share class not found.")
        existing = _replayed(
            RegisterOpening,
            operation_id,
            {
                **values,
                "token_id": token_id,
                "mapping": normalized,
                "source_document": document_id,
                "submitted_by_id": actor.pk,
            },
        )
        if existing:
            return existing
        if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED):
            raise ValidationError("A register opening requires a deployed share class.")
        register = ShareRegister.objects.filter(token=token).first()
        if register is not None and RegisterEntry.objects.filter(register=register).exists():
            raise ValidationError("This share class already has a stored register.")
        _members_of(company, normalized)
        lowered = {link["address"].lower(): link["member"] for link in normalized}
        if any(member != lowered[address] for address, member in _existing_links(company, normalized).items()):
            raise ValidationError("A mapped wallet address already belongs to another member of this company.")
        return _retain(
            RegisterOpening(uuid=operation_id, company=company, token=token, mapping=normalized, **values),
            document_id,
            actor,
        )


def _members_of(company, links):
    if RegisterMember.objects.filter(uuid__in=[link["member"] for link in links]).exclude(company=company).exists():
        raise ValidationError("Mapped members must belong to this company.")


def _existing_links(company, links):
    return {
        link.address_lower: str(link.member_id)
        for link in RegisterMemberWallet.objects.filter(company=company)
        .annotate(address_lower=Lower("address"))
        .filter(address_lower__in=[link["address"].lower() for link in links])
    }


def _retain(proposal, document_id, actor):
    document = CompanyDocument.objects.select_for_update().filter(pk=document_id, company=proposal.company).first()
    if document is None:
        raise NotFound("Company authority document not found.")
    document.company = proposal.company
    raw = private_document_bytes(document.file)
    proposal.source_document = document.pk
    proposal.evidence_fingerprint = document.verified_fingerprint
    proposal.evidence_snapshot = verified_document_snapshot(document, content=ContentFile(raw))
    proposal.submitted_by = actor
    proposal.file.save("authority.bin", ContentFile(raw), save=False)
    try:
        proposal.save(force_insert=True)
    except IntegrityError:
        raise RegisterChangeConflict() from None
    return proposal


def _replayed(model, operation_id, expected):
    existing = model.objects.filter(pk=operation_id).first()
    if existing and any(getattr(existing, key) != value for key, value in expected.items()):
        raise RegisterChangeConflict()
    return existing


def _reviewer(user, model=RegisterOpening):
    kind = model._meta.verbose_name.capitalize()
    if current_alias() == APP_ALIAS:
        raise PermissionDenied(f"{kind} review requires the operator connection.")
    reviewer = get_user_model().objects.get(pk=user.pk)
    if (
        not reviewer.is_active
        or not reviewer.is_staff
        or not reviewer.has_perm(f"tokens.change_{model._meta.model_name}")
    ):
        raise PermissionDenied(f"{kind} review requires an authorised staff reviewer.")
    return reviewer


def _check_evidence(proposal, company, document):
    kind = proposal._meta.verbose_name
    if company.owner_id != proposal.submitted_by_id or document is None or document.company_id != company.pk:
        raise ValidationError(f"The company or its authority document changed. Submit a fresh {kind}.")
    document.company = company
    if verified_document_snapshot(document) != proposal.evidence_snapshot or (
        document_fingerprint(document) != proposal.evidence_fingerprint
    ):
        raise ValidationError(f"The authority evidence changed. Submit a fresh {kind}.")
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
    try:
        client = client or get_base_chain_client()
        chain_id = client.assert_expected_chain()
        block = client.w3.eth.get_block(boundary["block"]["number"])
        covered = _boundary(client, boundary["policy"])
    except RegisterUnavailableException:
        raise
    except Exception:
        raise RegisterUnavailableException("The captured boundary could not be reverified against the chain.") from None
    if chain_id != boundary["chain_id"]:
        raise ValidationError("The captured boundary is not on the share class's original deployment chain.")
    if finality_policy(f"evm:{boundary['chain_id']}", BLOCKCHAIN_BASE) != boundary["policy"]:
        raise ValidationError("The approved finality policy changed since the boundary was captured.")
    block_hash = normalized_hash(block.get("hash")) if isinstance(block, Mapping) else None
    if block_hash is None or f"0x{block_hash}" != boundary["block"]["hash"]:
        raise ValidationError("The captured boundary block is no longer canonical.")
    if covered["number"] < boundary["block"]["number"]:
        raise ValidationError("The captured boundary is no longer covered by the approved finality policy.")


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
    assert_boundary_represents_completions(proposal.token_id, proposal.boundary)
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


def _completed_decision(proposal, reviewer, decision, rejection_reason):
    if proposal.reviewed_by_id == reviewer.pk and (
        (decision == "apply" and proposal.status == "applied")
        or (decision == "reject" and proposal.status == "rejected" and proposal.rejection_reason == rejection_reason)
    ):
        return proposal
    raise RegisterChangeConflict()


def _check_decision(decision, rejection_reason):
    if (
        decision not in ("apply", "reject")
        or (decision == "reject" and not rejection_reason.strip())
        or len(rejection_reason) > 1000
    ):
        raise ValidationError("Choose application or rejection with a reason.")


def _confirm(confirmation, salt, max_age, expected):
    try:
        preview = signing.loads(confirmation, salt=salt, max_age=max_age)
    except signing.BadSignature:
        raise ValidationError("The review confirmation is invalid or expired. Open a fresh review.") from None
    if preview != expected:
        *named, last = expected
        raise ValidationError(f"The confirmation belongs to another {', '.join(named)} or {last}.")


def _link(company, links):
    for link in links:
        create_member(company_id=company.pk, member_id=UUID(link["member"]))
        linked = _existing_links(company, [link])
        if not linked:
            RegisterMemberWallet.objects.create(
                company=company, member_id=UUID(link["member"]), address=link["address"]
            )
        elif linked[link["address"].lower()] != link["member"]:
            raise RegisterChangeConflict()


def decide_opening(*, proposal_id, reviewer, confirmation, decision, rejection_reason="", client=None):
    reviewer = _reviewer(reviewer)
    _check_decision(decision, rejection_reason)
    initial = RegisterOpening.objects.get(pk=proposal_id)
    if initial.status != "submitted":
        return _completed_decision(initial, reviewer, decision, rejection_reason)
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
            return _completed_decision(proposal, reviewer, decision, rejection_reason)
        if decision == "apply":
            _confirm(
                confirmation,
                "tokens.register-opening",
                REGISTER_OPENING_REVIEW_MAX_AGE,
                {
                    "proposal": str(proposal_id),
                    "reviewer": reviewer.pk,
                    "evidence": proposal.evidence_fingerprint,
                    "boundary": proposal.boundary["block"]["hash"],
                },
            )
            _check_evidence(proposal, company, document)
            register = _check_uninitialized(token)
            assert_boundary_represents_completions(token.pk, proposal.boundary)
            _link(company, proposal.mapping)
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


def _check_unlinked(company, links):
    _members_of(company, links)
    if _existing_links(company, links):
        raise ValidationError("A mapped wallet address is already linked to a member of this company.")


def submit_link(
    *,
    actor,
    operation_id,
    company_id,
    document_id,
    mapping,
    authority,
    approving_director,
    authority_reference,
    reason,
):
    if not get_user_model().objects.filter(pk=actor.pk, is_active=True).exists():
        raise PermissionDenied("An active company owner must submit the wallet links.")
    try:
        operation_id, company_id, document_id = (UUID(str(value)) for value in (operation_id, company_id, document_id))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Wallet link references must be UUIDs.") from None
    values = _authority_values(authority, approving_director, authority_reference, reason)
    normalized = _mapping(mapping)
    if not normalized:
        raise ValidationError("Name at least one wallet address and its member.")
    with atomic():
        company = Company.objects.select_for_update(no_key=True).filter(pk=company_id, owner=actor).first()
        if company is None:
            raise NotFound("Company not found.")
        existing = _replayed(
            RegisterWalletLink,
            operation_id,
            {
                **values,
                "company_id": company.pk,
                "mapping": normalized,
                "source_document": document_id,
                "submitted_by_id": actor.pk,
            },
        )
        if existing:
            return existing
        _check_unlinked(company, normalized)
        return _retain(
            RegisterWalletLink(uuid=operation_id, company=company, mapping=normalized, **values), document_id, actor
        )


def _link_preview(proposal, reviewer):
    return {"proposal": str(proposal.pk), "reviewer": reviewer.pk, "evidence": proposal.evidence_fingerprint}


def prepare_link_review(*, proposal_id, reviewer):
    reviewer = _reviewer(reviewer, RegisterWalletLink)
    proposal = RegisterWalletLink.objects.select_related("company").get(pk=proposal_id)
    if proposal.status != "submitted":
        raise ValidationError("This wallet link request already has a decision.")
    _check_evidence(proposal, proposal.company, CompanyDocument.objects.filter(pk=proposal.source_document).first())
    _check_unlinked(proposal.company, proposal.mapping)
    return proposal, signing.dumps(_link_preview(proposal, reviewer), salt="tokens.register-wallet-link")


def decide_link(*, proposal_id, reviewer, confirmation, decision, rejection_reason=""):
    reviewer = _reviewer(reviewer, RegisterWalletLink)
    _check_decision(decision, rejection_reason)
    initial = RegisterWalletLink.objects.get(pk=proposal_id)
    if initial.status != "submitted":
        return _completed_decision(initial, reviewer, decision, rejection_reason)
    with atomic():
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        document = CompanyDocument.objects.select_for_update().filter(pk=initial.source_document).first()
        proposal = RegisterWalletLink.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            return _completed_decision(proposal, reviewer, decision, rejection_reason)
        if decision == "apply":
            _confirm(
                confirmation,
                "tokens.register-wallet-link",
                REGISTER_LINK_REVIEW_MAX_AGE,
                _link_preview(proposal, reviewer),
            )
            _check_evidence(proposal, company, document)
            _check_unlinked(company, proposal.mapping)
            _link(company, proposal.mapping)
            proposal.status = "applied"
        else:
            proposal.status = "rejected"
            proposal.rejection_reason = rejection_reason
        proposal.reviewed_by = reviewer
        proposal.reviewed_at = timezone.now()
        proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
        return proposal
