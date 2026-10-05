from datetime import date
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyAppointment, CompanyCapability
from companies.services.authority_requests import _requester_principal
from shared.db import use_operator
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterCorrection,
    RegisterCorrectionDecision,
    RegisterEntry,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterPosition,
    ShareRegister,
)
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, decide, preview
from tokens.services.register_events import record_entry
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_openings import _authority_values

ENTRY_NOT_FOUND = "Register entry not found."
EVIDENCE_REFUSAL = "Name the authority document you uploaded for this company."


def _company_of(actor, entry_id):
    appointments = CompanyAppointment.objects.current_of(actor, at=timezone.now(), identity_required=False)
    with use_operator(), _requester_principal(actor.pk):
        company_id = (
            RegisterEntry.objects.filter(pk=entry_id, register__company_id__in=appointments.values("company_id"))
            .values_list("register__company_id", flat=True)
            .first()
        )
    if company_id is None:
        raise NotFound(ENTRY_NOT_FOUND)
    return company_id


def _negative(register_id, changes):
    held = dict(
        RegisterPosition.objects.filter(
            register_id=register_id, member_id__in=[change["member"] for change in changes]
        ).values_list("member_id", "shares")
    )
    return any(held.get(UUID(change["member"]), 0) + int(change["shares"]) < 0 for change in changes)


def prepare_correction(
    *,
    actor,
    operation_id,
    appointment,
    corrects_id,
    authority_evidence,
    effective_on,
    authority,
    approving_director,
    authority_reference,
    reason,
):
    try:
        operation_id, appointment, corrects_id, authority_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, corrects_id, authority_evidence)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Correction references must be UUIDs.") from None
    if type(effective_on) is not date:
        raise ValidationError("A correction requires an effective date.")
    if effective_on > timezone.now().date():
        raise ValidationError(
            "A correction cannot take effect after the day it is prepared. Date it today (UTC) or earlier."
        )
    values = _authority_values(authority, approving_director, authority_reference, reason)
    proposal = None
    try:
        with register_command(actor, _company_of(actor, corrects_id), "register_correction_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            original = RegisterEntry.objects.get(pk=corrects_id)
            register = ShareRegister.objects.select_for_update().get(pk=original.register_id)
            existing = RegisterCorrection.objects.filter(pk=operation_id).first()
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "corrects_id": corrects_id,
                    "authority_evidence_id": authority_evidence,
                    "effective_on": effective_on,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            if RegisterEntry.objects.filter(corrects=original).exists() or not original.changes:
                raise ValidationError("This entry cannot be compensated. Review the current register.")
            changes = [
                {"member": change["member"], "shares": str(-int(change["shares"]))} for change in original.changes
            ]
            if _negative(register.pk, changes):
                raise ValidationError(
                    "Applying this correction would take a member's holding below zero. Review the current register."
                )
            copy = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(copy, RegisterEvidenceKind.AUTHORITY, company, current_actor, EVIDENCE_REFUSAL)
            proposal = RegisterCorrection(
                uuid=operation_id,
                company=company,
                register=register,
                corrects=original,
                base_sequence=register.sequence,
                base_hash=register.head_hash,
                effective_on=effective_on,
                changes=changes,
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


def _effect_requirements(proposal):
    unmet = []
    try:
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    register = ShareRegister.objects.get(pk=proposal.register_id)
    if (register.sequence, register.head_hash) != (proposal.base_sequence, proposal.base_hash):
        unmet.append("register_changed")
    if RegisterEntry.objects.filter(corrects_id=proposal.corrects_id).exists():
        unmet.append("entry_already_corrected")
    if _negative(proposal.register_id, proposal.changes):
        unmet.append("position_would_go_negative")
    return unmet


def _details(proposal):
    return {
        "register_sequence": ShareRegister.objects.get(pk=proposal.register_id).sequence,
        "original_changes": proposal.corrects.changes,
        "changes": proposal.changes,
        "effective_on": proposal.effective_on,
    }


def _lock(proposal):
    ShareRegister.objects.select_for_update().get(pk=proposal.register_id)
    return RegisterCorrection.objects.select_for_update().get(pk=proposal.pk)


def _apply(proposal, actor, decision):
    proposal.applied_entry = record_entry(
        register_id=proposal.register_id,
        operation_id=proposal.pk,
        kind=RegisterEntryKind.CORRECTION,
        changes=proposal.changes,
        effective_on=proposal.effective_on,
        recorded_by=actor,
        corrects_id=proposal.corrects_id,
    )
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "applied_entry", "updated_at"])


CORRECTIONS = DecisionFamily(
    model=RegisterCorrection,
    decision_model=RegisterCorrectionDecision,
    field="register_correction",
    operation="register_correction",
    approved_function="tokens_register_correction_approved",
    digest_function="tokens_register_correction_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
)


def preview_correction_decision(*, actor, correction_id, appointment, kind, reason=""):
    return preview(
        CORRECTIONS, _details, actor=actor, proposal_id=correction_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_correction(
    *, actor, correction_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    return decide(
        CORRECTIONS,
        actor=actor,
        proposal_id=correction_id,
        appointment=appointment,
        kind=kind,
        idempotency_key=idempotency_key,
        preview_digest=preview_digest,
        confirmation=confirmation,
        reason=reason,
    )
