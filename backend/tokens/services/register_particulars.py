from datetime import date
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyAppointment, CompanyCapability
from companies.services.authority_requests import _requester_principal
from shared.db import use_operator
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterParticularsChange,
    RegisterParticularsChangeDecision,
    RegisterPosition,
)
from tokens.services.former_holders import member_left_on, retention_cutoff
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, decide, preview
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)

MEMBER_NOT_FOUND = "Register member not found."
EVIDENCE_REFUSAL = "Name the supporting document you uploaded for this company."
LIMITS = {
    "name": RegisterParticularsChange._meta.get_field("name").max_length,
    "residential address": REGISTER_IMPORT_ADDRESS_LENGTH,
    "reason": RegisterParticularsChange._meta.get_field("reason").max_length,
}


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"A particulars change needs a {label}.")
    if len(value.strip()) > LIMITS[label]:
        raise ValidationError(f"A particulars change's {label} may have at most {LIMITS[label]} characters.")
    return value.strip()


def _company_of(actor, member_id):
    appointments = CompanyAppointment.objects.current_of(actor, at=timezone.now(), identity_required=False)
    with use_operator(), _requester_principal(actor.pk):
        company_id = (
            RegisterMember.objects.filter(pk=member_id, company_id__in=appointments.values("company_id"))
            .values_list("company_id", flat=True)
            .first()
        )
    if company_id is None:
        raise NotFound(MEMBER_NOT_FOUND)
    return company_id


def _beyond_retention(member_id):
    positions = RegisterPosition.objects.filter(member_id=member_id)
    if positions.filter(shares__gt=0).exists():
        return False
    left_on = member_left_on(member_id)
    return left_on is None or left_on < retention_cutoff()


def prepare_particulars_change(
    *, actor, operation_id, appointment, member, supporting_evidence, name, residential_address, as_at, reason
):
    try:
        operation_id, appointment, member, supporting_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, member, supporting_evidence)
        )
        as_at = date.fromisoformat(str(as_at))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Particulars change references must be UUIDs and its date an ISO date.") from None
    if as_at > timezone.localdate():
        raise ValidationError(
            "A particulars change cannot be dated after the day it is prepared. Date it today (UTC) or earlier."
        )
    values = {
        "name": _text(name, "name"),
        "residential_address": _text(residential_address, "residential address"),
        "reason": _text(reason, "reason"),
    }
    change = None
    try:
        with register_command(actor, _company_of(actor, member), "register_particulars_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            subject = RegisterMember.objects.filter(pk=member, company=company).first()
            if subject is None:
                raise NotFound(MEMBER_NOT_FOUND)
            existing = RegisterParticularsChange.objects.filter(pk=operation_id).first()
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "member_id": subject.pk,
                    "supporting_evidence_id": supporting_evidence,
                    "as_at": as_at,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            held = RegisterMemberParticulars.objects.filter(member=subject).first()
            if held is not None and held.as_at > as_at:
                raise ValidationError(
                    f"The register already records this member's particulars as at {held.as_at.isoformat()}, after "
                    f"{as_at.isoformat()}. Date the change on or after {held.as_at.isoformat()}, or keep the later "
                    "particulars."
                )
            if _beyond_retention(subject.pk):
                raise ValidationError(
                    f"This member has held no shares since {retention_cutoff().isoformat()}, so the register no "
                    "longer keeps their particulars."
                )
            copy = RegisterEvidence.objects.select_for_update().filter(pk=supporting_evidence).first()
            raw = own_evidence_bytes(copy, RegisterEvidenceKind.SUPPORTING, company, current_actor, EVIDENCE_REFUSAL)
            change = RegisterParticularsChange(
                uuid=operation_id,
                company=company,
                member=subject,
                as_at=as_at,
                supporting_evidence=copy,
                evidence_fingerprint=copy.sha256,
                evidence_snapshot=evidence_snapshot(copy),
                preparing_appointment=source,
                submitted_by=current_actor,
                **values,
            )
            change.file.save("supporting.bin", ContentFile(raw), save=False)
            try:
                change.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return change, True
    except BaseException:
        if change is not None:
            discard(change.file)
        raise


def _effect_requirements(change):
    unmet = []
    try:
        matching_bytes(change.file, change.evidence_snapshot["file_size"], change.evidence_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    if _beyond_retention(change.member_id):
        unmet.append("member_left_retention")
    if RegisterMemberParticulars.objects.filter(member_id=change.member_id, as_at__gt=change.as_at).exists():
        unmet.append("newer_particulars_exist")
    return unmet


def _details(change):
    held = RegisterMemberParticulars.objects.filter(member_id=change.member_id).first()
    return {
        "member": change.member_id,
        "name": change.name,
        "residential_address": change.residential_address,
        "as_at": change.as_at,
        "current": (
            None
            if held is None
            else {
                "name": held.name,
                "residential_address": held.residential_address,
                "as_at": held.as_at,
                "source_import": held.source_import_id,
                "source_change": held.source_change_id,
                "source_grant": held.source_grant_id,
                "source_transfer": held.source_transfer_id,
            }
        ),
    }


def _lock(change):
    list(
        RegisterMemberParticulars.objects.select_for_update()
        .filter(member_id=change.member_id)
        .values_list("uuid", flat=True)
    )
    return RegisterParticularsChange.objects.select_for_update().get(pk=change.pk)


def _apply(change, actor, decision):
    RegisterMemberParticulars.objects.update_or_create(
        member_id=change.member_id,
        defaults={
            "name": change.name,
            "residential_address": change.residential_address,
            "as_at": change.as_at,
            "source_import": None,
            "source_grant": None,
            "source_transfer": None,
            "source_change": change,
        },
    )
    change.status = "applied"
    change.reviewed_by = actor
    change.reviewed_at = decision.decided_at
    change.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])


PARTICULARS = DecisionFamily(
    model=RegisterParticularsChange,
    decision_model=RegisterParticularsChangeDecision,
    field="register_particulars_change",
    operation="register_particulars",
    approved_function="tokens_register_particulars_approved",
    digest_function="tokens_register_particulars_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
    noun="change",
)


def preview_particulars_decision(*, actor, change_id, appointment, kind, reason=""):
    return preview(
        PARTICULARS, _details, actor=actor, proposal_id=change_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_particulars_change(
    *, actor, change_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    return decide(
        PARTICULARS,
        actor=actor,
        proposal_id=change_id,
        appointment=appointment,
        kind=kind,
        idempotency_key=idempotency_key,
        preview_digest=preview_digest,
        confirmation=confirmation,
        reason=reason,
    )
