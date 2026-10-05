from contextlib import contextmanager

from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.exceptions import IssuerIdentityVerificationRequiredException
from companies.models import CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation, lock_company_actor
from shared.db import atomic

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
