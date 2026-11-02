from django.db import connections
from django.utils import timezone
from rest_framework.exceptions import NotFound

from companies.exceptions import (
    CompanyActivationConflictException,
    IssuerIdentityVerificationRequiredException,
)
from companies.models import (
    CompanyActivation,
    CompanyAppointment,
    CompanyCapability,
    CompanyStatus,
)
from companies.services.administration import company_operation, lock_company_actor
from companies.services.authority import (
    DECLARATION_TEXT,
    DECLARATION_VERSION,
    _require_declaration,
)
from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import atomic, current_alias, use_operator

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


def _matches_request(receipt, actor, appointment, lifecycle_revision, declaration_version):
    return (
        receipt.activated_by_id == actor.pk
        and receipt.appointment_id == appointment.pk
        and receipt.lifecycle_revision == lifecycle_revision
        and receipt.declaration_version == declaration_version
        and receipt.declaration_text == DECLARATION_TEXT
    )


def _database_now():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT clock_timestamp()")
        return cursor.fetchone()[0]


def activate_company(
    *, actor, company_id, idempotency_key, appointment, lifecycle_revision, declaration_version, accept_declaration
):
    _require_declaration(declaration_version, accept_declaration)
    with company_operation(actor, company_id, "activation"), atomic(durable=True):
        company, current_actor, profile, operator = lock_company_actor(actor, company_id)
        source = _require_appointment(company, current_actor, profile, operator, appointment)
        prior = CompanyActivation.objects.filter(activated_by=current_actor, idempotency_key=idempotency_key).first()
        if prior:
            if prior.company_id != company.pk or not _matches_request(
                prior, current_actor, source, lifecycle_revision, declaration_version
            ):
                raise CompanyActivationConflictException()
            return company, prior
        if (
            company.status not in ONBOARDING_STATUSES
            or company.activated_at is not None
            or company.lifecycle_revision != lifecycle_revision
        ):
            raise CompanyActivationConflictException()
        receipt = CompanyActivation.objects.create(
            company=company,
            activated_by=current_actor,
            appointment=source,
            idempotency_key=idempotency_key,
            lifecycle_revision=company.lifecycle_revision,
            person_identity=_person_identity(current_actor, profile),
            issuer_identity_required=operator.issuer_kyc_required,
            declaration_version=DECLARATION_VERSION,
            declaration_text=DECLARATION_TEXT,
            activated_at=_database_now(),
        )
        company.status = CompanyStatus.ACTIVE
        company.activated_at = receipt.activated_at
        company.lifecycle_revision += 1
        company.save(update_fields=["status", "activated_at", "lifecycle_revision", "updated_at"])
        return company, receipt


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
    return {
        "appointment": source.pk,
        "lifecycle_revision": company.lifecycle_revision,
        "declaration_version": DECLARATION_VERSION,
        "declaration_text": DECLARATION_TEXT,
    }
