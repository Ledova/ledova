from uuid import UUID

from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyAppointment, CompanyCapability
from companies.services.authority_requests import _requester_principal
from shared.db import use_operator
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterAward,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterParticularsChange,
    RegisterPersonRegistration,
    RegisterPosition,
)
from tokens.services.former_holders import member_left_on, retention_cutoff
from tokens.services.register_authority import (
    APPOINTMENT_NOT_FOUND,
    holds,
    register_appointment,
    register_command,
)

MEMBER_NOT_FOUND = "Register member not found."
STALE = (
    "This member's recorded particulars changed after you read them. Check their current particulars and make the "
    "change again."
)
EDITORS = (CompanyCapability.PREPARE, CompanyCapability.APPROVE, CompanyCapability.APPLY)
LIMITS = {
    "name": RegisterParticularsChange._meta.get_field("name").max_length,
    "residential address": REGISTER_IMPORT_ADDRESS_LENGTH,
    "reason": RegisterParticularsChange._meta.get_field("reason").max_length,
}


def _text(value, label, optional=False):
    text = value.strip() if isinstance(value, str) else ""
    if not text and not optional:
        raise ValidationError(f"A particulars change needs a {label}.")
    if len(text) > LIMITS[label]:
        raise ValidationError(f"A particulars change's {label} may have at most {LIMITS[label]} characters.")
    return text


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
    if positions.filter(shares__gt=0).exists() or RegisterAward.objects.filter(member=member_id).exists():
        return False
    if not positions.exists() and RegisterPersonRegistration.objects.filter(member_id=member_id).exists():
        return False
    left_on = member_left_on(member_id)
    return left_on is None or left_on < retention_cutoff()


def _seen(particulars):
    if not particulars:
        return ("", "")
    return (particulars["name"], particulars["residential_address"])


def edit_particulars(*, actor, operation_id, appointment, member, name, residential_address, expected, reason=""):
    try:
        operation_id, appointment, member = (UUID(str(value)) for value in (operation_id, appointment, member))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Particulars change references must be UUIDs.") from None
    values = {
        "name": _text(name, "name"),
        "residential_address": _text(residential_address, "residential address"),
        "reason": _text(reason, "reason", optional=True),
    }
    seen = _seen(expected)
    with register_command(actor, _company_of(actor, member), "register_particulars_edit") as (
        company,
        current_actor,
        profile,
        operator,
    ):
        source = register_appointment(company, current_actor, profile, operator, appointment)
        if not all(holds(source, capability) for capability in EDITORS):
            raise NotFound(APPOINTMENT_NOT_FOUND)
        subject = RegisterMember.objects.filter(pk=member, company=company).first()
        if subject is None:
            raise NotFound(MEMBER_NOT_FOUND)
        existing = RegisterParticularsChange.objects.filter(pk=operation_id).first()
        if existing is not None:
            recorded = {
                **values,
                "company_id": company.pk,
                "member_id": subject.pk,
                "preparing_appointment_id": source.pk,
                "submitted_by_id": current_actor.pk,
                "status": "applied",
            }
            if (
                any(getattr(existing, key) != value for key, value in recorded.items())
                or _seen(existing.previous_particulars) != seen
            ):
                raise RegisterChangeConflict()
            return existing, False
        held = RegisterMemberParticulars.objects.select_for_update().filter(member=subject).first()
        current = ("", "") if held is None else (held.name, held.residential_address)
        if current != seen:
            raise RegisterChangeConflict(STALE)
        if current == (values["name"], values["residential_address"]):
            raise ValidationError("These are already the member's recorded name and residential address.")
        if _beyond_retention(subject.pk):
            raise ValidationError(
                f"This member has held no shares since {retention_cutoff().isoformat()}, so the register no "
                "longer keeps their particulars."
            )
        change = RegisterParticularsChange(
            uuid=operation_id,
            company=company,
            member=subject,
            as_at=timezone.now().date(),
            evidence_fingerprint="",
            evidence_snapshot={},
            preparing_appointment=source,
            submitted_by=current_actor,
            status="applied",
            reviewed_by=current_actor,
            **values,
        )
        try:
            change.save(force_insert=True)
        except IntegrityError:
            raise RegisterChangeConflict() from None
        RegisterMemberParticulars.objects.update_or_create(
            member=subject,
            defaults={
                "name": change.name,
                "residential_address": change.residential_address,
                "as_at": change.as_at,
                "source_import": None,
                "source_grant": None,
                "source_allotment": None,
                "source_transfer": None,
                "source_award": None,
                "source_registration": None,
                "source_change": change,
            },
        )
        return change, True
