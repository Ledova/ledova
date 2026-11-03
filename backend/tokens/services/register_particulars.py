from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation
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
from tokens.services.member_events import current_associations
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
LINKED = (
    "This member keeps their name and address up to date in their Ledova profile, so the company does not change "
    "them here."
)
LONG_ADDRESS = (
    f"A residential address may have at most {REGISTER_IMPORT_ADDRESS_LENGTH:,} characters, because the companies "
    "whose registers you are linked to record it."
)
PROFILE = "member_particulars_profile"
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
        if current_associations(company_id=company.pk, member=subject.pk).exists():
            raise ValidationError(LINKED)
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
        _hold(change)
        return change, True


def _hold(change):
    RegisterMemberParticulars.objects.update_or_create(
        member_id=change.member_id,
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


def _provided(value, kept):
    return value if isinstance(value, str) and value.strip() else kept


def apply_profile(actor, profile, association):
    with company_operation(actor, association.company_id, PROFILE):
        list(Company.objects.select_for_update().filter(pk=association.company_id).values_list("pk", flat=True))
        held = RegisterMemberParticulars.objects.select_for_update().filter(member_id=association.member).first()
        if held is None or not current_associations(pk=association.pk, user=actor).exists():
            return None
        name = _provided(profile.full_name, held.name)
        address = _provided(profile.residential_address, held.residential_address)
        if (name, address) == (held.name, held.residential_address):
            return None
        if len(address) > REGISTER_IMPORT_ADDRESS_LENGTH:
            raise ValidationError({"residential_address": [LONG_ADDRESS]})
        change = RegisterParticularsChange.objects.create(
            company_id=association.company_id,
            member_id=association.member,
            member_association=association,
            name=name,
            residential_address=address,
            as_at=timezone.now().date(),
            evidence_fingerprint="",
            evidence_snapshot={},
            submitted_by=actor,
            status="applied",
            reviewed_by=actor,
        )
        _hold(change)
        return change


def lock_profile_save(actor):
    linked = current_associations(user=actor).order_by("company_id").values_list("company_id", flat=True)
    for company_id in linked.distinct():
        with company_operation(actor, company_id, PROFILE):
            list(Company.objects.select_for_update().filter(pk=company_id).values_list("pk", flat=True))
    get_object_or_404(get_user_model().objects.select_for_update(), pk=actor.pk, is_active=True)


def follow_profile(actor, profile):
    for association in current_associations(user=actor).order_by("company_id", "uuid"):
        apply_profile(actor, profile, association)
