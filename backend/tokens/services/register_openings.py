import hashlib
from collections import Counter, defaultdict
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

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyDocument,
)
from companies.services.authority_requests import _requester_principal
from companies.services.document_review import (
    document_fingerprint,
    private_document_bytes,
    verified_document_snapshot,
)
from integrations.base_chain import get_base_chain_client
from integrations.blockchain.receipts import normalized_hash
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, current_alias, use_operator
from tokens.exceptions import (
    RegisterChangeConflict,
    RegisterOpeningHoldingsMoved,
    RegisterUnavailableException,
)
from tokens.models import (
    RegisterDecisionKind,
    RegisterEntry,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterOpeningDecision,
    RegisterWalletLink,
    RegisterWalletLinkDecision,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register import _snapshot, member_identities
from tokens.services.register_authority import (
    APPOINTMENT_NOT_FOUND,
    register_appointment,
    register_command,
)
from tokens.services.register_decisions import (
    CAPABILITY,
    DecisionFamily,
    decide,
    preview,
)
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_inclusions import (
    assert_boundary_represents_completions,
    record_completed_effects,
    waiting_list,
)
from tokens.services.register_snapshot import _boundary, capture_snapshot
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.services.chain_observations import finality_policy
from whitelist.models import WhitelistApproval, WhitelistEntry
from whitelist.services.identity import identities_for

SHARE_CLASS_NOT_FOUND = "Share class not found."
COMPANY_NOT_FOUND = "Company not found."
EVIDENCE_REFUSAL = "Name the authority document you uploaded for this company."
PROVEN = "proven"
NOT_PROVEN = "not_proven"


def _mapping(mapping):
    if not isinstance(mapping, list):
        raise ValidationError("The mapping must be a list of wallet addresses and member IDs.")
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
        raise ValidationError("The mapping requires wallet addresses and member UUIDs.") from None
    if len({link["address"].lower() for link in normalized}) != len(normalized):
        raise ValidationError("The mapping repeats a wallet address.")
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


def _company_of(actor, token_id):
    appointments = CompanyAppointment.objects.current_of(actor, at=timezone.now(), identity_required=False)
    with use_operator(), _requester_principal(actor.pk):
        company_id = (
            ShareToken.objects.filter(pk=token_id, company_id__in=appointments.values("company_id"))
            .values_list("company_id", flat=True)
            .first()
        )
    if company_id is None:
        raise NotFound(SHARE_CLASS_NOT_FOUND)
    return company_id


def _holding(actor, company_id, appointment, capability):
    with use_operator(), _requester_principal(actor.pk):
        return (
            CompanyAppointment.objects.current_for(actor, company_id, at=timezone.now(), identity_required=False)
            .filter(pk=appointment)
            .holding_any([CompanyCapability.ADMIN, capability])
            .exists()
        )


def _check_unopened(token):
    if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED):
        raise ValidationError("A register opening requires a deployed share class.")
    if RegisterEntry.objects.filter(register__token=token).exists():
        raise ValidationError("This share class already has a stored register.")


def _linked_elsewhere(company, links):
    lowered = {link["address"].lower(): link["member"] for link in links}
    return any(member != lowered[address] for address, member in _existing_links(company, links).items())


def _holder(row, links, people):
    member = links.get(row["address"].lower())
    return {
        **row,
        "member": member,
        "member_name": None if member is None else people[UUID(member)].name or None,
        "member_exists": member is not None,
    }


def opening_holders(token):
    _check_unopened(token)
    boundary = capture_snapshot(token.pk)
    holdings = sorted(boundary["holdings"], key=lambda row: (-int(row["shares"]), row["address"].lower()))
    links = _existing_links(token.company_id, holdings)
    people = member_identities(token, sorted({UUID(member) for member in links.values()}))
    return {"block": boundary["block"], "holdings": [_holder(row, links, people) for row in holdings]}


def prepare_opening(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    authority_evidence,
    mapping,
    authority,
    approving_director,
    authority_reference,
    reason,
    client=None,
):
    try:
        operation_id, appointment, token_id, authority_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, token_id, authority_evidence)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Opening references must be UUIDs.") from None
    values = _authority_values(authority, approving_director, authority_reference, reason)
    normalized = _mapping(mapping)
    company_id = _company_of(actor, token_id)
    if not _holding(actor, company_id, appointment, CompanyCapability.PREPARE):
        raise NotFound(APPOINTMENT_NOT_FOUND)
    with use_operator(), _requester_principal(actor.pk):
        retried = RegisterOpening.objects.filter(pk=operation_id).exists()
        if not retried:
            _check_unopened(ShareToken.objects.get(pk=token_id))
        boundary = None if retried else capture_snapshot(token_id, client=client)
    proposal = None
    try:
        with register_command(actor, company_id, "register_opening_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            token = ShareToken.objects.select_for_update().filter(pk=token_id, company=company).first()
            if token is None:
                raise NotFound(SHARE_CLASS_NOT_FOUND)
            existing = RegisterOpening.objects.filter(pk=operation_id).first()
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "token_id": token.pk,
                    "mapping": normalized,
                    "authority_evidence_id": authority_evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            _check_unopened(token)
            _members_of(company, normalized)
            if _linked_elsewhere(company, normalized):
                raise ValidationError("A mapped wallet address already belongs to another member of this company.")
            _check_mapping_against_boundary(normalized, boundary)
            assert_boundary_represents_completions(token.pk, boundary)
            copy = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(copy, RegisterEvidenceKind.AUTHORITY, company, current_actor, EVIDENCE_REFUSAL)
            proposal = RegisterOpening(
                uuid=operation_id,
                company=company,
                token=token,
                mapping=normalized,
                boundary=boundary,
                preparing_appointment=source,
                authority_evidence=copy,
                evidence_fingerprint=copy.sha256,
                evidence_snapshot=evidence_snapshot(copy),
                submitted_by=current_actor,
                **values,
            )
            proposal.file.save("authority.bin", ContentFile(raw), save=False)
            try:
                proposal.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return proposal, True
    except BaseException:
        if proposal is not None:
            discard(proposal.file)
        raise


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
        raise RegisterOpeningHoldingsMoved()


def _recheck_boundary(boundary):
    try:
        client = get_base_chain_client()
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
    from tokens.services.register_deployments import pending_deployment

    if pending_deployment(token):
        raise ValidationError("The original company deployment must be projected before the register can advance.")
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


def _boundary_requirements(actor, proposal, kind, appointment):
    if (
        kind == RegisterDecisionKind.REJECT
        or proposal.status != "submitted"
        or proposal.preparing_appointment_id is None
    ):
        return []
    if not _holding(actor, proposal.company_id, appointment, CAPABILITY[kind]):
        return ["appointment_capability_required"]
    try:
        _recheck_boundary(proposal.boundary)
    except ValidationError:
        return ["boundary_changed"]
    return []


def _effect_requirements(proposal):
    from tokens.services.register_deployments import pending_deployment

    unmet = []
    if pending_deployment(proposal.token):
        unmet.append("deployment_pending")
    try:
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    if RegisterEntry.objects.filter(register__token_id=proposal.token_id).exists():
        unmet.append("register_initialized")
    try:
        assert_boundary_represents_completions(proposal.token_id, proposal.boundary)
    except ValidationError:
        unmet.append("completions_not_represented")
    if _linked_elsewhere(proposal.company_id, proposal.mapping):
        unmet.append("wallet_linked_elsewhere")
    return unmet


def _details(proposal):
    boundary = proposal.boundary
    return {
        "changes": _opening_changes(proposal) if boundary else [],
        "effective_on": date.fromisoformat(boundary["block"]["date"]) if boundary else None,
    }


def _lock(proposal):
    ShareToken.objects.select_for_update().get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    return RegisterOpening.objects.select_for_update().get(pk=proposal.pk)


def _apply(proposal, actor, decision):
    register = _check_uninitialized(proposal.token)
    _link(proposal.company, proposal.mapping)
    proposal.applied_entry = record_entry(
        register_id=register.pk,
        operation_id=proposal.pk,
        kind=RegisterEntryKind.OPENING,
        changes=_opening_changes(proposal),
        effective_on=date.fromisoformat(proposal.boundary["block"]["date"]),
        recorded_by=actor,
    )
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "applied_entry", "updated_at"])


OPENINGS = DecisionFamily(
    model=RegisterOpening,
    decision_model=RegisterOpeningDecision,
    field="register_opening",
    operation="register_opening",
    approved_function="tokens_register_opening_approved",
    digest_function="tokens_register_opening_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
    before_command=_boundary_requirements,
)


def preview_opening_decision(*, actor, opening_id, appointment, kind, reason=""):
    return preview(
        OPENINGS, _details, actor=actor, proposal_id=opening_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_opening(*, actor, opening_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""):
    return decide(
        OPENINGS,
        actor=actor,
        proposal_id=opening_id,
        appointment=appointment,
        kind=kind,
        idempotency_key=idempotency_key,
        preview_digest=preview_digest,
        confirmation=confirmation,
        reason=reason,
    )


def _appointed_in(actor, company_id):
    appointments = CompanyAppointment.objects.current_of(actor, at=timezone.now(), identity_required=False)
    with use_operator(), _requester_principal(actor.pk):
        if not appointments.filter(company_id=company_id).exists():
            raise NotFound(COMPANY_NOT_FOUND)


def prepare_link(
    *,
    actor,
    operation_id,
    appointment,
    company_id,
    authority_evidence,
    mapping,
    authority,
    approving_director,
    authority_reference,
    reason,
):
    try:
        operation_id, appointment, company_id, authority_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, company_id, authority_evidence)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Wallet link references must be UUIDs.") from None
    values = _authority_values(authority, approving_director, authority_reference, reason)
    normalized = _mapping(mapping)
    if not normalized:
        raise ValidationError("Name at least one wallet address and its member.")
    _appointed_in(actor, company_id)
    link = None
    try:
        with register_command(actor, company_id, "register_link_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            existing = RegisterWalletLink.objects.filter(pk=operation_id).first()
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "mapping": normalized,
                    "authority_evidence_id": authority_evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            _members_of(company, normalized)
            if _existing_links(company, normalized):
                raise ValidationError("A mapped wallet address is already linked to a member of this company.")
            copy = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(copy, RegisterEvidenceKind.AUTHORITY, company, current_actor, EVIDENCE_REFUSAL)
            link = RegisterWalletLink(
                uuid=operation_id,
                company=company,
                mapping=normalized,
                preparing_appointment=source,
                authority_evidence=copy,
                evidence_fingerprint=copy.sha256,
                evidence_snapshot=evidence_snapshot(copy),
                submitted_by=current_actor,
                **values,
            )
            link.file.save("authority.bin", ContentFile(raw), save=False)
            try:
                link.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return link, True
    except BaseException:
        if link is not None:
            discard(link.file)
        raise


def wallet_statuses(company_id, addresses):
    listed = {
        approval.entry.wallet_address.lower()
        for approval in WhitelistApproval.objects.filter(
            company_id=company_id, entry__in=WhitelistEntry.objects.for_addresses(addresses)
        ).select_related("entry__wallet")
    }
    identities = identities_for(sorted(listed))
    proven = set(
        Wallet.objects.filter(chain=BLOCKCHAIN_BASE, verification_status=WALLET_VERIFICATION_STATUS_VERIFIED)
        .annotate(lowered=Lower("address"))
        .filter(lowered__in=listed)
        .values_list("lowered", flat=True)
    )

    def status(key):
        if key not in listed:
            return {"wallet_proof": None, "holder_type": None, "holder_name": None}
        return {
            "wallet_proof": PROVEN if key in proven else NOT_PROVEN,
            "holder_type": identities[key].holder_type,
            "holder_name": identities[key].name or None,
        }

    return {address.lower(): status(address.lower()) for address in addresses}


def mapping_summary(link):
    existing = {
        str(member)
        for member in RegisterMember.objects.filter(
            company_id=link.company_id, pk__in=[item["member"] for item in link.mapping]
        ).values_list("pk", flat=True)
    }
    return [{**item, "member_exists": item["member"] in existing} for item in link.mapping]


def waiting_wallets(actor, company_id):
    company = Company.objects.register_preparable_by(actor).filter(pk=company_id).first()
    if company is None:
        raise NotFound(COMPANY_NOT_FOUND)
    waiting = Counter()
    with _snapshot():
        for token_id in ShareToken.objects.filter(company=company).order_by("pk").values_list("pk", flat=True):
            for effect in waiting_list(token_id) or []:
                waiting.update({Web3.to_checksum_address(address) for address in effect["unlinked_wallets"]})
        statuses = wallet_statuses(company.pk, list(waiting))
    return [
        {"address": address, "waiting": waiting[address], **statuses[address.lower()]}
        for address in sorted(waiting, key=str.lower)
    ]


def _link_requirements(link):
    unmet = []
    try:
        matching_bytes(link.file, link.evidence_snapshot["file_size"], link.evidence_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    if _linked_elsewhere(link.company_id, link.mapping):
        unmet.append("wallet_linked_elsewhere")
    return unmet


def _link_details(link):
    statuses = wallet_statuses(link.company_id, [item["address"] for item in link.mapping])
    return {"links": [{**row, **statuses[row["address"].lower()]} for row in mapping_summary(link)]}


def _lock_link(link):
    list(
        ShareToken.objects.select_for_update()
        .filter(company_id=link.company_id)
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    return RegisterWalletLink.objects.select_for_update().get(pk=link.pk)


def _apply_link(link, actor, decision):
    _link(link.company, link.mapping)
    for token_id in ShareToken.objects.filter(company_id=link.company_id).order_by("pk").values_list("pk", flat=True):
        record_completed_effects(token_id)
    link.status = "applied"
    link.reviewed_by = actor
    link.reviewed_at = decision.decided_at
    link.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])


LINKS = DecisionFamily(
    model=RegisterWalletLink,
    decision_model=RegisterWalletLinkDecision,
    field="register_wallet_link",
    operation="register_link",
    approved_function="tokens_register_link_approved",
    digest_function="tokens_register_link_decision_digest",
    effect_requirements=_link_requirements,
    lock=_lock_link,
    apply=_apply_link,
)


def preview_link_decision(*, actor, link_id, appointment, kind, reason=""):
    return preview(
        LINKS, _link_details, actor=actor, proposal_id=link_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_link(*, actor, link_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""):
    return decide(
        LINKS,
        actor=actor,
        proposal_id=link_id,
        appointment=appointment,
        kind=kind,
        idempotency_key=idempotency_key,
        preview_digest=preview_digest,
        confirmation=confirmation,
        reason=reason,
    )
