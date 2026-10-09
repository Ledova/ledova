from contextlib import contextmanager

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.models import REGISTER_READERS, CompanyAppointment
from tokens.models import ShareRegister, ShareToken
from tokens.services.register import inspection_copy_preview, prepare_inspection_copy
from tokens.services.register_authority import (
    APPOINTMENT_NOT_FOUND,
    register_appointment,
    register_command,
)


@contextmanager
def _access(actor, token):
    with register_command(actor, token.company_id, "register_inspection_copy") as (company, actor, profile, operator):
        token = get_object_or_404(ShareToken.objects.select_for_update(), pk=token.pk, company=company)
        list(ShareRegister.objects.select_for_update().filter(token=token).values_list("pk", flat=True))
        yield company, actor, profile, operator, token


def _appointment(company, actor, profile, operator, appointment_id):
    appointment = register_appointment(company, actor, profile, operator, appointment_id)
    if not set(REGISTER_READERS) & set(appointment.capabilities):
        raise NotFound(APPOINTMENT_NOT_FOUND)
    return appointment


def preview_company_inspection_copy(*, actor, token):
    with _access(actor, token) as (company, actor, profile, operator, token):
        appointment = (
            CompanyAppointment.objects.current_for(actor, company.pk, at=timezone.now(), identity_required=False)
            .holding_any(REGISTER_READERS)
            .order_by("uuid")
            .first()
        )
        if appointment is None:
            raise NotFound(APPOINTMENT_NOT_FOUND)
        _appointment(company, actor, profile, operator, appointment.pk)
        preview = {**inspection_copy_preview(token), "appointment": appointment.pk}
        _appointment(company, actor, profile, operator, appointment.pk)
        return preview


def prepare_company_inspection_copy(*, actor, token, appointment, source_digest, instruction, requested_on, recipient):
    with _access(actor, token) as (company, actor, profile, operator, token):
        _appointment(company, actor, profile, operator, appointment)
        content = prepare_inspection_copy(
            token,
            actor,
            instruction=instruction,
            requested_on=requested_on,
            recipient=recipient,
            source_digest=source_digest,
        )
        _appointment(company, actor, profile, operator, appointment)
        return content
