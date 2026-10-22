from django.db import IntegrityError
from django.utils import timezone

from companies.models import CompanyCapability
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterMember,
    RegisterMemberParticulars,
    RegisterPersonRegistration,
)
from tokens.services.register_authority import (
    current_register_reader,
    register_appointment,
    register_command,
)
from tokens.services.register_transfers import register_people


def company_people(*, actor, company_id):
    with register_command(actor, company_id, "register_people_read") as (company, actor, profile, operator):
        current_register_reader(company, actor, profile, operator)
        return {"company": company.pk, "members": register_people(company.pk, actor)["members"]}


def add_person(*, actor, operation_id, company, appointment, member, name, residential_address):
    with register_command(actor, company, "register_person_add") as (company, actor, profile, operator):
        source = register_appointment(company, actor, profile, operator, appointment, CompanyCapability.PREPARE)
        expected = {
            "company_id": company.pk,
            "member_id": member,
            "name": name.strip(),
            "residential_address": residential_address.strip(),
            "preparing_appointment_id": source.pk,
            "submitted_by_id": actor.pk,
        }
        prior = RegisterPersonRegistration.objects.filter(pk=operation_id).first()
        if prior is not None:
            if any(getattr(prior, key) != value for key, value in expected.items()):
                raise RegisterChangeConflict()
            return prior, False
        if RegisterMember.objects.filter(pk=member).exists():
            raise RegisterChangeConflict()
        try:
            registration = RegisterPersonRegistration.objects.create(uuid=operation_id, **expected)
            RegisterMember.objects.create(uuid=member, company=company)
            RegisterMemberParticulars.objects.create(
                member_id=member,
                name=registration.name,
                residential_address=registration.residential_address,
                as_at=timezone.now().date(),
                source_registration=registration,
            )
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return registration, True
