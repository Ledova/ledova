from contextlib import contextmanager

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.exceptions import IssuerIdentityVerificationRequiredException
from companies.models import REGISTER_READERS, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation, lock_company_actor
from shared.db import atomic
from tokens.models import ShareRegister, ShareToken

APPOINTMENT_NOT_FOUND = "Company appointment not found or no longer effective."


@contextmanager
def register_command(actor, company_id, operation):
    with company_operation(actor, company_id, operation), atomic(durable=True):
        yield lock_company_actor(actor, company_id)


def register_appointment(company, actor, profile, operator, appointment_id, capability=None):
    if profile is None:
        raise NotFound(APPOINTMENT_NOT_FOUND)
    appointments = CompanyAppointment.objects.current_for(
        actor, company.pk, at=timezone.now(), identity_required=False
    ).filter(pk=appointment_id, appointee_profile=profile)
    if capability is not None:
        appointments = appointments.holding_any([CompanyCapability.ADMIN, capability])
    appointment = appointments.first()
    if appointment is None:
        raise NotFound(APPOINTMENT_NOT_FOUND)
    if operator.issuer_kyc_required and not profile.is_id_verified:
        raise IssuerIdentityVerificationRequiredException()
    return appointment


def holds(appointment, capability):
    return bool({CompanyCapability.ADMIN, capability} & set(appointment.capabilities))


@contextmanager
def register_output_access(actor, token, operation):
    with register_command(actor, token.company_id, operation) as (company, actor, profile, operator):
        token = get_object_or_404(ShareToken.objects.select_for_update(), pk=token.pk, company=company)
        list(ShareRegister.objects.select_for_update().filter(token=token).values_list("pk", flat=True))
        yield company, actor, profile, operator, token


def register_reader_appointment(company, actor, profile, operator, appointment_id):
    appointment = register_appointment(company, actor, profile, operator, appointment_id)
    if not set(REGISTER_READERS) & set(appointment.capabilities):
        raise NotFound(APPOINTMENT_NOT_FOUND)
    return appointment


def current_register_reader(company, actor, profile, operator):
    appointment = (
        CompanyAppointment.objects.current_for(actor, company.pk, at=timezone.now(), identity_required=False)
        .holding_any(REGISTER_READERS)
        .order_by("uuid")
        .first()
    )
    if appointment is None:
        raise NotFound(APPOINTMENT_NOT_FOUND)
    return register_reader_appointment(company, actor, profile, operator, appointment.pk)
