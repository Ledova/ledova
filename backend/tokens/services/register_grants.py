import re
from datetime import date
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError, connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from shared.db import current_alias
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterAward,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterGrant,
    RegisterGrantDecision,
    RegisterImport,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    RegisterPosition,
    ShareRegister,
    ShareToken,
)
from tokens.models.choices import ShareTokenStatus
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, decide, preview
from tokens.services.register_events import (
    company_event_requirements,
    create_member,
    record_entry,
)
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_imports import _company_of
from tokens.services.register_instructions import _named


def _text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValidationError(f"A non-paid grant needs a {label} with at most {limit} characters.")
    return value.strip()


def _state(proposal):
    unmet = []
    token = ShareToken.objects.get(pk=proposal.token_id)
    register = ShareRegister.objects.filter(token=token, sequence__gt=0).first()
    if (
        token.status != ShareTokenStatus.DRAFT
        or token.contract_address
        or token.deployment_id
        or token.deployment_transaction_id
        or token.deployment_tx_hash
        or token.deployed_at
        or token.chain
        or not RegisterImport.objects.filter(token=token, status="applied").exists()
        or register is None
    ):
        unmet.append("imported_non_tokenised_register_required")
    if register is not None:
        after = int(register.issued_supply) + int(proposal.shares)
        if after > int(token.total_supply) or after >= 2**256:
            unmet.append("authorised_headroom_required")
        unmet.extend(company_event_requirements(proposal, register))
    if _named(proposal.approving_director) == _named(proposal.name):
        unmet.append("approving_director_conflict")
    if RegisterMemberWallet.objects.filter(company_id=proposal.company_id, member_id=proposal.member).exists():
        unmet.append("member_wallet_linked")
    member = RegisterMember.objects.filter(pk=proposal.member).first()
    if proposal.new_member:
        if member is not None:
            unmet.append("member_reference_conflict")
    else:
        held = RegisterMemberParticulars.objects.filter(
            member_id=proposal.member, member__company_id=proposal.company_id
        ).first()
        if member is None or member.company_id != proposal.company_id or held is None:
            unmet.append("identified_company_member_required")
        else:
            if (held.name, held.residential_address) != (proposal.name, proposal.residential_address):
                unmet.append("member_particulars_changed")
            if _named(proposal.approving_director) == _named(held.name):
                unmet.append("approving_director_conflict")
    return unmet


def prepare_grant(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    member,
    new_member,
    shares,
    company_event_on,
    terms_on,
    approving_director,
    terms,
    authority_reference,
    reason,
    authority_evidence,
    terms_evidence,
    acceptance_required,
    acceptance_evidence=None,
    name="",
    residential_address="",
    award=None,
):
    try:
        company_event_on = date.fromisoformat(str(company_event_on))
        operation_id, appointment, token_id, member, authority_evidence, terms_evidence = (
            UUID(str(value))
            for value in (operation_id, appointment, token_id, member, authority_evidence, terms_evidence)
        )
        acceptance_evidence = UUID(str(acceptance_evidence)) if acceptance_evidence is not None else None
        award = UUID(str(award)) if award is not None else None
        terms_on = date.fromisoformat(str(terms_on))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Grant references must be UUIDs and the terms date an ISO date.") from None
    if type(new_member) is not bool or type(acceptance_required) is not bool:
        raise ValidationError("State whether the member is new and the terms require acceptance.")
    if acceptance_required != (acceptance_evidence is not None):
        raise ValidationError("Retain acceptance evidence exactly when the company's terms require acceptance.")
    if terms_on > timezone.now().date():
        raise ValidationError("A grant's terms date cannot be in the future (UTC).")
    if not isinstance(shares, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", shares) or int(shares) >= 2**256:
        raise ValidationError("A non-paid grant needs positive whole shares within the share limit.")
    if not isinstance(name, str) or not isinstance(residential_address, str):
        raise ValidationError("Member identity fields must be text.")
    if new_member:
        name = _text(name, "member name", 255)
        residential_address = _text(residential_address, "residential address", REGISTER_IMPORT_ADDRESS_LENGTH)
    values = {
        "company_event_on": company_event_on,
        "shares": int(shares),
        "terms_on": terms_on,
        "approving_director": _text(approving_director, "named approving director", 255),
        "new_member": new_member,
        "terms": _text(terms, "non-paid terms summary", 1000),
        "authority_reference": _text(authority_reference, "company authority reference", 255),
        "reason": _text(reason, "reason", 1000),
        "acceptance_required": acceptance_required,
    }
    proposal = None
    try:
        with register_command(actor, _company_of(actor, token_id), "register_grant_prepare") as (
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
                raise NotFound("Share class not found.")
            list(ShareRegister.objects.select_for_update().filter(token=token).values_list("uuid", flat=True))
            promised = None
            if award is not None:
                promised = RegisterAward.objects.select_for_update().filter(pk=award, company=company).first()
                if promised is None:
                    raise NotFound("Employee award not found.")
            existing = RegisterGrant.objects.filter(pk=operation_id).first()
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "token_id": token.pk,
                    "award_id": award,
                    "member": member,
                    "name": name.strip() if name else existing.name,
                    "residential_address": (
                        residential_address.strip() if residential_address else existing.residential_address
                    ),
                    "authority_evidence_id": authority_evidence,
                    "terms_evidence_id": terms_evidence,
                    "acceptance_evidence_id": acceptance_evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            if not new_member:
                held = (
                    RegisterMemberParticulars.objects.select_for_update()
                    .filter(member_id=member, member__company=company)
                    .first()
                )
                if held is None:
                    raise ValidationError("Choose an identified member of this company's register.")
                if (name and name.strip() != held.name) or (
                    residential_address and residential_address.strip() != held.residential_address
                ):
                    raise ValidationError("An existing member's identity must match the retained particulars.")
                name, residential_address = held.name, held.residential_address
            values.update(
                name=_text(name, "member name", 255),
                residential_address=_text(residential_address, "residential address", REGISTER_IMPORT_ADDRESS_LENGTH),
            )
            proposal = RegisterGrant(
                uuid=operation_id,
                company=company,
                token=token,
                award_id=award,
                member=member,
                preparing_appointment=source,
                submitted_by=current_actor,
                **values,
            )
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            for prefix, reference, kind in (
                ("", authority_evidence, RegisterEvidenceKind.AUTHORITY),
                ("terms_", terms_evidence, RegisterEvidenceKind.SUPPORTING),
                ("acceptance_", acceptance_evidence, RegisterEvidenceKind.SUPPORTING),
            ):
                if reference is None:
                    continue
                evidence = RegisterEvidence.objects.select_for_update().filter(pk=reference).first()
                if prefix == "terms_" and promised is not None and reference == promised.agreement_evidence_id:
                    if evidence is None or (
                        evidence.kind,
                        evidence.company_id,
                        evidence.sha256,
                        evidence_snapshot(evidence),
                    ) != (
                        RegisterEvidenceKind.SUPPORTING,
                        company.pk,
                        promised.agreement_fingerprint,
                        promised.agreement_snapshot,
                    ):
                        raise ValidationError("The retained award agreement no longer matches its evidence.")
                    raw = matching_bytes(
                        promised.file, promised.agreement_snapshot["file_size"], promised.agreement_fingerprint
                    )
                    fingerprint, snapshot = promised.agreement_fingerprint, promised.agreement_snapshot
                else:
                    raw = own_evidence_bytes(
                        evidence,
                        kind,
                        company,
                        current_actor,
                        "Name the required evidence you uploaded for this company.",
                    )
                    fingerprint, snapshot = evidence.sha256, evidence_snapshot(evidence)
                setattr(proposal, "authority_evidence" if not prefix else f"{prefix}evidence", evidence)
                setattr(proposal, f"{prefix}fingerprint" if prefix else "evidence_fingerprint", fingerprint)
                setattr(proposal, f"{prefix}snapshot" if prefix else "evidence_snapshot", snapshot)
                getattr(proposal, f"{prefix}file").save("evidence.bin", ContentFile(raw), save=False)
            unmet = _award_requirements(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            try:
                proposal.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return proposal, True
    except BaseException:
        if proposal is not None:
            discard(proposal.file, proposal.terms_file, proposal.acceptance_file)
        raise


def _award_requirements(proposal):
    if proposal.award_id is None:
        return []
    from tokens.services.register_awards import award_latest_on, award_quantities

    award = RegisterAward.objects.filter(pk=proposal.award_id).first()
    if award is None or (
        award.company_id,
        award.token_id,
        award.member,
        award.terms_on,
        award.terms,
        award.agreement_fingerprint,
    ) != (
        proposal.company_id,
        proposal.token_id,
        proposal.member,
        proposal.terms_on,
        proposal.terms,
        proposal.terms_fingerprint,
    ):
        return ["award_binding_required"]
    unmet = []
    quantities = award_quantities(award, excluding_grant=proposal.pk)
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT tokens_employee_award_vested_on(%s, %s)", [award.pk, proposal.company_event_on])
        vested = int(cursor.fetchone()[0]) if proposal.company_event_on else 0
    if proposal.company_event_on and proposal.company_event_on < award_latest_on(award):
        unmet.append("award_chronology_changed")
    issued = int(quantities["issued_shares"])
    ended = int(quantities["ended_vested_shares"])
    if int(proposal.shares) > min(vested - issued - ended, int(quantities["available_shares"])):
        unmet.append("recorded_vested_quantity_required")
    try:
        matching_bytes(award.file, award.agreement_snapshot["file_size"], award.agreement_fingerprint)
        for event in [*award.vestings.all(), *award.ends.all(), *award.vesting_reversals.all()]:
            matching_bytes(event.file, event.evidence_snapshot["file_size"], event.evidence_fingerprint)
    except ValidationError:
        unmet.append("award_evidence_unavailable")
    return unmet


def _effect_requirements(proposal):
    unmet = _state(proposal) + _award_requirements(proposal)
    try:
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
        matching_bytes(proposal.terms_file, proposal.terms_snapshot["file_size"], proposal.terms_fingerprint)
        if proposal.acceptance_required:
            matching_bytes(
                proposal.acceptance_file, proposal.acceptance_snapshot["file_size"], proposal.acceptance_fingerprint
            )
    except ValidationError:
        unmet.append("evidence_unavailable")
    return unmet


def _details(proposal):
    token = ShareToken.objects.get(pk=proposal.token_id)
    register = ShareRegister.objects.filter(token=token).first()
    held = RegisterPosition.objects.filter(register=register, member_id=proposal.member).first()
    issued, shares = int(register.issued_supply) if register else 0, int(held.shares) if held else 0
    details = {
        "member": proposal.member,
        "new_member": proposal.new_member,
        "name": proposal.name,
        "residential_address": proposal.residential_address,
        "shares": str(proposal.shares),
        "company_event_on": proposal.company_event_on,
        "effective_on": proposal.company_event_on,
        "terms_on": proposal.terms_on,
        "approving_director": proposal.approving_director,
        "terms": proposal.terms,
        "acceptance_required": proposal.acceptance_required,
        "register_sequence": register.sequence if register else 0,
        "issued_supply": str(issued),
        "authorised_supply": token.total_supply,
        "after_issued_supply": str(issued + int(proposal.shares)),
        "current_shares": str(shares),
        "after_shares": str(shares + int(proposal.shares)),
    }
    if proposal.award_id is not None:
        from tokens.services.register_awards import award_quantities

        award = RegisterAward.objects.get(pk=proposal.award_id)
        quantities = award_quantities(award)
        details.update(
            award=award.pk,
            award_promised_shares=str(award.shares),
            **{f"award_{key}": value for key, value in quantities.items()},
        )
    return details


def _lock(proposal):
    ShareToken.objects.select_for_update().get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    if proposal.award_id is not None:
        RegisterAward.objects.select_for_update().get(pk=proposal.award_id)
    list(
        RegisterMemberParticulars.objects.select_for_update()
        .filter(member_id=proposal.member)
        .values_list("uuid", flat=True)
    )
    return RegisterGrant.objects.select_for_update().get(pk=proposal.pk)


def _apply(proposal, actor, decision):
    effective_on = proposal.company_event_on
    if proposal.new_member:
        create_member(company_id=proposal.company_id, member_id=proposal.member)
        RegisterMemberParticulars.objects.create(
            member_id=proposal.member,
            name=proposal.name,
            residential_address=proposal.residential_address,
            as_at=timezone.now().date(),
            source_grant=proposal,
        )
    proposal.register_entry = record_entry(
        register_id=ShareRegister.objects.get(token_id=proposal.token_id).pk,
        operation_id=proposal.pk,
        kind=RegisterEntryKind.ISSUE,
        changes=[{"member": str(proposal.member), "shares": str(proposal.shares)}],
        effective_on=effective_on,
        recorded_by=actor,
    )
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "register_entry", "reviewed_by", "reviewed_at", "updated_at"])


GRANTS = DecisionFamily(
    model=RegisterGrant,
    decision_model=RegisterGrantDecision,
    field="register_grant",
    operation="register_grant",
    approved_function="tokens_register_grant_approved",
    digest_function="tokens_register_grant_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
    noun="grant",
)


def preview_grant_decision(*, actor, grant_id, appointment, kind, reason=""):
    return preview(
        GRANTS, _details, actor=actor, proposal_id=grant_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_grant(*, actor, grant_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""):
    try:
        return decide(
            GRANTS,
            actor=actor,
            proposal_id=grant_id,
            appointment=appointment,
            kind=kind,
            idempotency_key=idempotency_key,
            preview_digest=preview_digest,
            confirmation=confirmation,
            reason=reason,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None
