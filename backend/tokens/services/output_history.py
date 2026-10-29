from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.models import CompanyAppointment, CompanyCapability
from tokens.models import RegisterExport, RegisterExportKind, RegisterExportRoute
from tokens.services.register_authority import (
    APPOINTMENT_NOT_FOUND,
    current_register_reader,
    register_appointment,
    register_command,
    register_output_access,
)
from users.models import UserProfile

HISTORY_LIMIT = 50


def _names(user_ids):
    return {
        user_id: name or ""
        for user_id, name in UserProfile.objects.filter(user_id__in=user_ids).values_list("user_id", "full_name")
    }


def inspection_copy_history(*, actor, token):
    with register_output_access(actor, token, "register_inspection_copy") as (company, actor, profile, operator, token):
        current_register_reader(company, actor, profile, operator)
        rows = list(
            RegisterExport.objects.filter(
                token=token, kind=RegisterExportKind.INSPECTION_COPY, produced_through=RegisterExportRoute.COMPANY
            )[:HISTORY_LIMIT]
        )
        names = _names({row.requested_by_id for row in rows})
        return [
            {
                "uuid": row.pk,
                "prepared_at": row.created_at,
                "prepared_by_name": names.get(row.requested_by_id, ""),
                "requested_on": row.requested_on,
                "recipient": row.recipient,
                "instruction": row.instruction,
                "late": row.late,
                "member_rows": row.member_rows,
                "former_rows": row.former_rows,
            }
            for row in rows
        ]


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
        rows = list(
            RegisterExport.objects.filter(
                kind=RegisterExportKind.COMPANY_PACK,
                token__company=company,
                produced_through=RegisterExportRoute.COMPANY,
            )
        )
        names = _names({row.requested_by_id for row in rows})
        packs = {}
        for row in rows:
            pack = packs.setdefault(
                row.digest,
                {
                    "digest": row.digest,
                    "prepared_at": row.created_at,
                    "prepared_by_name": names.get(row.requested_by_id, ""),
                    "instruction": row.instruction,
                    "recipient": row.recipient,
                    "classes": 0,
                },
            )
            pack["classes"] += 1
            pack["prepared_at"] = min(pack["prepared_at"], row.created_at)
        return list(packs.values())[:HISTORY_LIMIT]
