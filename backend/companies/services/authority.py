from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.exceptions import (
    AuthorityAdmissionConflictException,
    AuthorityRequestConflictException,
    IssuerIdentityVerificationRequiredException,
)
from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyAuthorityRequest,
    CompanyCapability,
    CompanyRegistryCheck,
    CompanyStatus,
    RegistryCheckPurpose,
    RegistryCheckStatus,
)
from companies.services.authority_requests import (
    _requester_principal,
    _require_requester,
    _snapshots,
)
from companies.services.registry import begin_registry_check, perform_registry_check
from operators.models import Operator
from shared.db import atomic, use_app, use_operator
from users.models import UserProfile

DECLARATION_VERSION = "2026-10-04"
DECLARATION_TEXT = (
    "I am authorised to act for this company. The company is responsible for the company and share information "
    "it provides, its ASIC filings and legal obligations."
)


def _require_declaration(declaration_version, accept_declaration):
    if declaration_version != DECLARATION_VERSION or accept_declaration is not True:
        raise ValidationError({"accept_declaration": "Accept the current company authorisation declaration."})


def _locked_request(requester, request_id):
    proposal = get_object_or_404(CompanyAuthorityRequest, pk=request_id, requester=requester)
    company = get_object_or_404(Company.objects.select_for_update(), pk=proposal.company_id)
    actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=requester.pk)
    _require_requester(actor)
    profile = get_object_or_404(UserProfile.objects.select_for_update(), user=actor)
    proposal = get_object_or_404(CompanyAuthorityRequest.objects.select_for_update(), pk=request_id, requester=actor)
    return actor, profile, company, proposal


def _require_initial_admission(actor, profile, company, proposal):
    if getattr(proposal, "withdrawal", None):
        raise AuthorityAdmissionConflictException("A withdrawn request cannot establish company authority.")
    if company.owner_id != actor.pk or company.status != CompanyStatus.DRAFT:
        raise AuthorityAdmissionConflictException("Initial authority requires current ownership of your draft company.")
    if CompanyCapability.ADMIN not in proposal.requested_capabilities:
        raise ValidationError({"requested_capabilities": "Initial company authority must include administration."})
    if proposal.requested_expires_at and proposal.requested_expires_at <= timezone.now():
        raise ValidationError({"requested_expires_at": "The proposed appointment has expired. Submit a new request."})
    snapshots = _snapshots(company, actor, profile)
    retained = (
        proposal.company_identity_raw,
        proposal.company_identity,
        proposal.person_identity_raw,
        proposal.person_identity,
    )
    if proposal.requester_profile_id != profile.pk or snapshots != retained:
        raise AuthorityRequestConflictException()
    if Operator.get().issuer_kyc_required and not profile.is_id_verified:
        raise IssuerIdentityVerificationRequiredException()


def _existing_admission(company, proposal):
    appointment = CompanyAppointment.objects.filter(company=company, request__isnull=False).first()
    if appointment and appointment.request_id != proposal.pk:
        raise AuthorityAdmissionConflictException(
            "Initial authority is already recorded. Use company administrator changes."
        )
    return appointment


def _retained_request(request_id):
    return CompanyAuthorityRequest.objects.select_related("withdrawal", "appointment__revocation").get(pk=request_id)


def admit_authority_request(*, requester, request_id, declaration_version, accept_declaration):
    _require_requester(requester)
    _require_declaration(declaration_version, accept_declaration)
    with use_app(), _requester_principal(requester.pk):
        get_object_or_404(CompanyAuthorityRequest.objects.filter(requester=requester), pk=request_id)
    with use_operator(), _requester_principal(requester.pk):
        with atomic():
            actor, profile, company, proposal = _locked_request(requester, request_id)
            if _existing_admission(company, proposal):
                return _retained_request(proposal.pk)
            _require_initial_admission(actor, profile, company, proposal)
            check = begin_registry_check(company, RegistryCheckPurpose.AUTHORITY, actor)
        check = perform_registry_check(check)
        with atomic():
            actor, profile, company, proposal = _locked_request(requester, request_id)
            if _existing_admission(company, proposal):
                return _retained_request(proposal.pk)
            _require_initial_admission(actor, profile, company, proposal)
            check = CompanyRegistryCheck.objects.select_for_update().get(pk=check.pk)
            if not (
                check.status == RegistryCheckStatus.PASSED
                and check.completed_at
                and check.company_id == company.pk
                and check.initiated_by_id == actor.pk
                and check.purpose == RegistryCheckPurpose.AUTHORITY
                and check.identity == proposal.company_identity
                and check.lifecycle_revision == company.lifecycle_revision
            ):
                raise ValidationError({"company": "A current matching ABR company lookup must pass. Retry admission."})
            CompanyAppointment.objects.create(
                company=company,
                appointee_id=proposal.requester_id,
                appointee_profile_id=proposal.requester_profile_id,
                request=proposal,
                registry_check=check,
                capabilities=proposal.requested_capabilities,
                delegatable_capabilities=proposal.delegatable_capabilities,
                expires_at=proposal.requested_expires_at,
                declaration_version=DECLARATION_VERSION,
                declaration_text=DECLARATION_TEXT,
            )
            return _retained_request(proposal.pk)


def has_company_capability(*, requester, company_id, capability):
    if not requester.is_authenticated or capability not in CompanyCapability.values:
        return False
    with use_app(), _requester_principal(requester.pk):
        return (
            CompanyAppointment.objects.current_for(
                requester,
                company_id,
                at=timezone.now(),
                identity_required=Operator.get().issuer_kyc_required,
            )
            .filter(capabilities__contains=[capability])
            .exists()
        )


def is_company_appointment_effective(appointment):
    with use_app(), _requester_principal(appointment.appointee_id):
        return (
            CompanyAppointment.objects.current_for(
                appointment.appointee,
                appointment.company_id,
                at=timezone.now(),
                identity_required=Operator.get().issuer_kyc_required,
            )
            .filter(pk=appointment.pk)
            .exists()
        )


def revoke_authority_request(*, requester, request_id):
    _require_requester(requester)
    with use_app(), _requester_principal(requester.pk):
        get_object_or_404(CompanyAuthorityRequest.objects.filter(requester=requester), pk=request_id)
    with use_operator(), _requester_principal(requester.pk), atomic():
        actor, profile, company, proposal = _locked_request(requester, request_id)
        appointment = CompanyAppointment.objects.select_for_update().filter(request=proposal).first()
        if appointment is None:
            raise ValidationError({"request": "This request has no admitted appointment to revoke."})
        CompanyAppointmentRevocation.objects.get_or_create(appointment=appointment, defaults={"revoked_by": actor})
        return _retained_request(proposal.pk)
