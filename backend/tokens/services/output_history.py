from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.models import CompanyAppointment, CompanyCapability
from tokens.models import RegisterExport, RegisterExportKind
from tokens.services.register_authority import (
    APPOINTMENT_NOT_FOUND,
    current_register_reader,
    register_appointment,
    register_command,
    register_output_access,
)
from users.models import UserProfile

HISTORY_LIMIT = 50


def _company_people(company, user_ids):
    appointed = CompanyAppointment.objects.filter(company=company, appointee_id__in=user_ids).values("appointee_id")
    people = get_user_model().objects.filter(pk__in=appointed, is_staff=False, is_superuser=False)
    names = dict(UserProfile.objects.filter(user__in=people).values_list("user_id", "full_name"))
    return {pk: names.get(pk) or "" for pk in people.values_list("pk", flat=True)}


def inspection_copy_history(*, actor, token):
    with register_output_access(actor, token, "register_inspection_copy") as (company, actor, profile, operator, token):
        current_register_reader(company, actor, profile, operator)
        rows = list(RegisterExport.objects.filter(token=token, kind=RegisterExportKind.INSPECTION_COPY))
        people = _company_people(company, {row.requested_by_id for row in rows})
        return [
            {
                "uuid": row.pk,
                "prepared_at": row.created_at,
                "prepared_by_name": people[row.requested_by_id],
                "requested_on": row.requested_on,
                "recipient": row.recipient,
                "instruction": row.instruction,
                "late": row.late,
                "member_rows": row.member_rows,
                "former_rows": row.former_rows,
            }
            for row in rows
            if row.requested_by_id in people
        ][:HISTORY_LIMIT]


def company_pack_history(*, actor, company_id):
    with register_command(actor, company_id, "company_pack_history") as (company, actor, profile, operator):
        appointment = (
            CompanyAppointment.objects.current_for(actor, company.pk, at=timezone.now(), identity_required=False)
            .holding_any([CompanyCapability.ADMIN])
            .order_by("uuid")
            .first()
        )
        if appointment is None:
            raise NotFound(APPOINTMENT_NOT_FOUND)
        register_appointment(company, actor, profile, operator, appointment.pk, CompanyCapability.ADMIN)
        rows = list(RegisterExport.objects.filter(kind=RegisterExportKind.COMPANY_PACK, token__company=company))
        people = _company_people(company, {row.requested_by_id for row in rows})
        packs = {}
        for row in rows:
            if row.requested_by_id not in people:
                continue
            pack = packs.setdefault(
                row.digest,
                {
                    "digest": row.digest,
                    "prepared_at": row.created_at,
                    "prepared_by_name": people[row.requested_by_id],
                    "instruction": row.instruction,
                    "recipient": row.recipient,
                    "classes": 0,
                },
            )
            pack["classes"] += 1
            pack["prepared_at"] = min(pack["prepared_at"], row.created_at)
        return list(packs.values())[:HISTORY_LIMIT]
