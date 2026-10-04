from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.exceptions import (
    CompanyActivationConflictException,
    IssuerIdentityVerificationRequiredException,
)
from companies.identity import company_identity
from companies.models import (
    CompanyAppointment,
    CompanyCapability,
    CompanyRegistryCheck,
    CompanyStatus,
    RegistryCheckPurpose,
    RegistryCheckStatus,
)
from companies.services.administration import company_operation, lock_company_actor
from companies.services.authority import (
    DECLARATION_TEXT,
    DECLARATION_VERSION,
    _require_declaration,
)
from companies.services.authority_requests import _requester_principal
from companies.services.registry import _begin_registry_check, perform_registry_check
from operators.models import Operator
from shared.db import atomic, use_operator

ONBOARDING_STATUSES = (
    CompanyStatus.DRAFT,
    CompanyStatus.SUBMITTED,
    CompanyStatus.REVIEW,
    CompanyStatus.INFO_REQUIRED,
    CompanyStatus.APPROVED,
    CompanyStatus.REJECTED,
    CompanyStatus.WITHDRAWN,
)


def _person_identity(actor, profile):
    return {
        "user_id": actor.pk,
        "profile_uuid": str(profile.pk),
        "email": actor.email,
        "full_name": profile.full_name or "",
        "is_id_verified": profile.is_id_verified,
        "kyc_provider": profile.kyc_provider,
        "kycaid_applicant_id": profile.kycaid_applicant_id,
        "sumsub_applicant_id": profile.sumsub_applicant_id,
        "verification_status": profile.verification_status,
        "review_result": profile.review_result,
        "verified_at": profile.verified_at.isoformat() if profile.verified_at else None,
    }


def _require_appointment(company, actor, profile, operator, appointment_id):
    if profile is None:
        raise NotFound("Company appointment not found or no longer effective.")
    appointment = (
        CompanyAppointment.objects.current_for(actor, company.pk, at=timezone.now(), identity_required=False)
        .filter(pk=appointment_id, appointee_profile=profile, capabilities__contains=[CompanyCapability.ADMIN])
        .first()
    )
    if appointment is None:
        raise NotFound("Company appointment not found or no longer effective.")
    if operator.issuer_kyc_required and not profile.is_id_verified:
        raise IssuerIdentityVerificationRequiredException()
    return appointment


def _matches_request(check, actor, appointment, lifecycle_revision, declaration_version):
    return (
        check.initiated_by_id == actor.pk
        and check.initiating_appointment_id == appointment.pk
        and check.lifecycle_revision == lifecycle_revision
        and check.declaration_version == declaration_version
        and check.declaration_text == DECLARATION_TEXT
        and check.purpose == RegistryCheckPurpose.ACTIVATION
    )


def _require_current_attempt(company, actor, profile, operator, check):
    if (
        check.company_id != company.pk
        or check.initiated_by_id != actor.pk
        or check.lifecycle_revision != company.lifecycle_revision
        or check.identity != company_identity(company)
        or (check.requested_name, check.requested_acn, check.requested_abn) != (company.name, company.acn, company.abn)
        or check.person_identity != _person_identity(actor, profile)
        or check.issuer_identity_required != operator.issuer_kyc_required
        or check.declaration_version != DECLARATION_VERSION
        or check.declaration_text != DECLARATION_TEXT
    ):
        raise CompanyActivationConflictException()


def activate_company(
    *, actor, company_id, idempotency_key, appointment, lifecycle_revision, declaration_version, accept_declaration
):
    _require_declaration(declaration_version, accept_declaration)
    perform_check = False
    with company_operation(actor, company_id, "activation"), atomic(durable=True):
        company, current_actor, profile, operator = lock_company_actor(actor, company_id)
        source = _require_appointment(company, current_actor, profile, operator, appointment)
        prior = (
            CompanyRegistryCheck.objects.select_for_update()
            .filter(initiated_by=current_actor, idempotency_key=idempotency_key)
            .first()
        )
        if prior:
            source = _require_appointment(company, current_actor, profile, operator, appointment)
            if prior.company_id != company.pk or not _matches_request(
                prior, current_actor, source, lifecycle_revision, declaration_version
            ):
                raise CompanyActivationConflictException()
            if prior.applied_at is not None:
                return company, prior
            _require_current_attempt(company, current_actor, profile, operator, prior)
            if prior.status != RegistryCheckStatus.PASSED or prior.completed_at is None:
                return company, prior
            check = prior
        else:
            if (
                company.status not in ONBOARDING_STATUSES
                or company.activated_at is not None
                or company.lifecycle_revision != lifecycle_revision
            ):
                raise CompanyActivationConflictException()
            with company_operation(current_actor, company.pk, "registry"):
                check = _begin_registry_check(
                    company,
                    RegistryCheckPurpose.ACTIVATION,
                    current_actor,
                    initiating_appointment=source,
                    idempotency_key=idempotency_key,
                    person_identity=_person_identity(current_actor, profile),
                    issuer_identity_required=operator.issuer_kyc_required,
                    declaration_version=DECLARATION_VERSION,
                    declaration_text=DECLARATION_TEXT,
                )
            perform_check = True
    if perform_check:
        check = perform_registry_check(check)
    with company_operation(actor, company_id, "activation"), atomic(durable=True):
        company, current_actor, profile, operator = lock_company_actor(actor, company_id)
        source = _require_appointment(company, current_actor, profile, operator, appointment)
        check = get_object_or_404(CompanyRegistryCheck.objects.select_for_update(), pk=check.pk)
        source = _require_appointment(company, current_actor, profile, operator, appointment)
        if not _matches_request(check, current_actor, source, lifecycle_revision, declaration_version):
            raise CompanyActivationConflictException()
        _require_current_attempt(company, current_actor, profile, operator, check)
        if check.status != RegistryCheckStatus.PASSED or check.completed_at is None:
            return company, check
        if (
            company.status not in ONBOARDING_STATUSES
            or company.activated_at is not None
            or company.registry_check_id != check.pk
        ):
            raise CompanyActivationConflictException()
        check.applied_at = timezone.now()
        check.save(update_fields=["applied_at", "updated_at"])
        company.status = CompanyStatus.ACTIVE
        company.activated_at = check.applied_at
        company.lifecycle_revision += 1
        company.save(update_fields=["status", "activated_at", "lifecycle_revision", "updated_at"])
        return company, check


def company_activation(company, actor):
    if actor is None or not actor.is_authenticated:
        return None
    with use_operator(), _requester_principal(actor.pk):
        source = (
            CompanyAppointment.objects.current_for(
                actor, company.pk, at=timezone.now(), identity_required=Operator.get().issuer_kyc_required
            )
            .filter(capabilities__contains=[CompanyCapability.ADMIN])
            .order_by("uuid")
            .first()
        )
        if source is None:
            return None
        latest = CompanyRegistryCheck.objects.filter(
            company=company, initiated_by=actor, initiating_appointment=source, purpose=RegistryCheckPurpose.ACTIVATION
        ).first()
        return {
            "appointment": source.pk,
            "lifecycle_revision": company.lifecycle_revision,
            "declaration_version": DECLARATION_VERSION,
            "declaration_text": DECLARATION_TEXT,
            "latest_attempt": latest,
        }
