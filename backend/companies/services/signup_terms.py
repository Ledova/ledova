from django.shortcuts import get_object_or_404

from companies.models import Company, CompanyAppointment, CompanySignupTermsAcceptance
from companies.services.authority import (
    SIGNUP_DECLARATION_TEXT,
    SIGNUP_DECLARATION_VERSION,
    _require_declaration,
)
from companies.services.authority_requests import (
    _requester_principal,
    _require_requester,
)
from companies.services.team import _current, _locked_actor
from operators.models import Operator
from shared.db import atomic, use_app, use_operator


def signup_terms_receipt(appointment, requester):
    if not requester.is_authenticated or requester.pk != appointment.appointee_id:
        return None
    if (
        appointment.request_id
        and appointment.declaration_version == SIGNUP_DECLARATION_VERSION
        and appointment.declaration_text == SIGNUP_DECLARATION_TEXT
    ):
        accepted_at = appointment.created_at
    else:
        with use_operator(), _requester_principal(requester.pk):
            acceptance = CompanySignupTermsAcceptance.objects.filter(
                company_id=appointment.company_id,
                appointment=appointment,
                accepted_by_id=appointment.appointee_id,
                accepted_profile_id=appointment.appointee_profile_id,
                declaration_version=SIGNUP_DECLARATION_VERSION,
                declaration_text=SIGNUP_DECLARATION_TEXT,
            ).first()
        if acceptance is None:
            return None
        accepted_at = acceptance.created_at
    return {
        "company": appointment.company_id,
        "appointment": appointment.pk,
        "accepted_by": appointment.appointee_id,
        "accepted_profile": appointment.appointee_profile_id,
        "declaration_version": SIGNUP_DECLARATION_VERSION,
        "declaration_text": SIGNUP_DECLARATION_TEXT,
        "accepted_at": accepted_at,
    }


def accept_signup_terms(*, requester, appointment_id, declaration_version, accept_declaration):
    _require_requester(requester)
    _require_declaration(declaration_version, accept_declaration, version=SIGNUP_DECLARATION_VERSION)
    with use_app(), _requester_principal(requester.pk):
        source = get_object_or_404(CompanyAppointment, pk=appointment_id, appointee=requester)
    with use_operator(), _requester_principal(requester.pk), atomic():
        company = get_object_or_404(Company.objects.select_for_update(), pk=source.company_id)
        actor, profile = _locked_actor(requester)
        Operator.objects.select_for_update().get(pk=Operator.get().pk)
        appointment = get_object_or_404(
            _current(actor, company.pk)
            .select_for_update(of=("self",))
            .select_related("company", "appointee", "revocation"),
            pk=appointment_id,
            appointee_profile=profile,
            capabilities__contains=["admin"],
        )
        if signup_terms_receipt(appointment, actor) is None:
            CompanySignupTermsAcceptance.objects.create(
                company=company,
                appointment=appointment,
                accepted_by=actor,
                accepted_profile=profile,
                declaration_version=SIGNUP_DECLARATION_VERSION,
                declaration_text=SIGNUP_DECLARATION_TEXT,
            )
        return appointment
