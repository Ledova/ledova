import logging
from typing import Any, Dict, Optional

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import NotFound

from integrations.kyc import get_kyc_provider
from integrations.kyc.base import (
    KYCProvider,
    NormalizedVerificationResult,
    VerificationSession,
)
from integrations.kyc.constants import (
    PROVIDER_KYCAID,
    PROVIDER_SUMSUB,
    REVIEW_GREEN,
    REVIEW_RED,
    REVIEW_YELLOW,
)
from operators.models import Operator
from shared.db import atomic, principal_of, use_operator
from shared.models.country import Country
from shared.tasks.queue import defer
from users.exceptions import VerificationTokenGenerationException
from users.models.user_account import UserAccount
from users.models.user_profile import UserProfile
from users.services.accounts import lock_active_profile
from users.services.erasure import queue_provider_erasure
from whitelist.models import WhitelistInvalidationCause
from whitelist.services.eligibility_invalidation import invalidation_writer_context
from whitelist.services.refresh import enqueue_for_account

logger = logging.getLogger(__name__)

REVIEW_OUTCOME_MESSAGES = {
    REVIEW_GREEN: ("Identity verified", "Your identity has been verified."),
    REVIEW_RED: (
        "Verification needs attention",
        "We could not verify your identity. Please review your verification details.",
    ),
    REVIEW_YELLOW: ("Verification needs attention", "Your identity verification needs another attempt."),
}


def create_applicant(kyc_provider: KYCProvider, user_profile: UserProfile) -> dict:
    try:
        with use_operator(), atomic():
            user = lock_active_profile(user_profile)
            if user is None:
                raise NotFound("This account is closed.")
            provider_name = kyc_provider.get_provider_name()
            applicant_field = "kycaid_applicant_id" if provider_name == PROVIDER_KYCAID else "sumsub_applicant_id"
            if getattr(user_profile, applicant_field):
                return {"applicant_id": getattr(user_profile, applicant_field)}
            completion_email = user.email
            result = kyc_provider.create_applicant(
                str(user_profile.uuid),
                first_name=user_profile.full_name.split()[0] if user_profile.full_name else None,
                last_name=user_profile.full_name.split()[-1] if user_profile.full_name else None,
                dob=str(user_profile.date_of_birth) if user_profile.date_of_birth else None,
                email=completion_email,
            )
            closed = lock_active_profile(user_profile) is None
            if closed:
                queue_provider_erasure(user, provider_name, result.get("applicant_id"), completion_email)
            else:
                setattr(user_profile, applicant_field, result.get("applicant_id"))
                user_profile.kyc_provider = provider_name
                user_profile.save(update_fields=[applicant_field, "kyc_provider", "updated_at"])

        if closed:
            raise NotFound("This account is closed.")

        return result
    except NotFound:
        raise
    except Exception as e:
        logger.error(
            f"Failed to create applicant for user profile {user_profile.uuid}: {e}",
            exc_info=True,
        )
        raise VerificationTokenGenerationException("Unable to initialize verification. Please try again later.")


def get_verification_session(user_profile: UserProfile) -> VerificationSession:
    with use_operator(), atomic():
        if lock_active_profile(user_profile) is None:
            raise NotFound("This account is closed.")
    kyc_provider = get_kyc_provider()
    external_id = str(user_profile.uuid)

    if not user_profile.active_applicant_id:
        create_applicant(kyc_provider, user_profile)
        user_profile.refresh_from_db()

    applicant_id = user_profile.active_applicant_id
    try:
        session = kyc_provider.generate_session(applicant_id, external_id)
    except Exception:
        logger.warning("Identity verification session unavailable; existing applicant retained")
        raise VerificationTokenGenerationException(
            "Unable to initialize verification. Please try again later."
        ) from None
    with use_operator(), atomic():
        if lock_active_profile(user_profile) is None:
            raise NotFound("This account is closed.")
    return session


def get_verification_status(user_profile: UserProfile) -> dict:
    with use_operator(), atomic():
        if lock_active_profile(user_profile) is None:
            raise NotFound("This account is closed.")
    kyc_provider = get_kyc_provider()
    applicant_id = user_profile.active_applicant_id

    if applicant_id and not user_profile.is_id_verified:
        try:
            status_data = kyc_provider.get_applicant_status(applicant_id)
            status_data = kyc_provider.with_approval_evidence(applicant_id, status_data)
            normalized = kyc_provider.normalize_status(status_data)
            if normalized.review_result:
                update_status_from_normalized(user_profile, normalized)
        except Exception as e:
            logger.warning(f"Failed to fetch live status for applicant {applicant_id}, using cached data: {e}")
            user_profile.refresh_from_db()

    response_data = {
        "provider": user_profile.kyc_provider,
        "applicantId": applicant_id,
        "status": user_profile.verification_status,
        "reviewResult": user_profile.review_result,
        "reviewAnswer": user_profile.review_result,
        "isVerified": user_profile.is_id_verified,
        "verifiedAt": user_profile.verified_at,
        "rejectionLabels": user_profile.rejection_labels or [],
        "needsRetry": user_profile.needs_verification_retry,
        "extractedData": None,
    }

    if user_profile.is_id_verified and applicant_id:
        try:
            applicant_data = kyc_provider.get_applicant_data(applicant_id)
            extracted_data = kyc_provider.extract_verified_data(applicant_data)
            response_data["extractedData"] = extracted_data
            populate_profile(user_profile, extracted_data)
        except Exception as e:
            logger.warning(f"Failed to extract verified data for applicant {applicant_id}: {e}")

    with use_operator(), atomic():
        if lock_active_profile(user_profile) is None:
            raise NotFound("This account is closed.")
    return response_data


def update_status_from_normalized(user_profile: UserProfile, normalized: NormalizedVerificationResult) -> bool:
    principal = principal_of()
    with use_operator():
        actor = get_user_model().objects.get(pk=principal) if principal else None
    with invalidation_writer_context(actor):
        user_account = (
            UserAccount.objects.select_for_update(no_key=True).filter(user_profile_id=user_profile.pk).first()
        )
        if lock_active_profile(user_profile) is None:
            return False
        previous_result = user_profile.review_result
        user_profile.verification_status = normalized.verification_status
        user_profile.review_result = normalized.review_result
        user_profile.rejection_labels = normalized.rejection_labels or None

        if user_profile.kyc_provider == PROVIDER_SUMSUB:
            user_profile.sumsub_verification_status = normalized.verification_status

        if normalized.document_type or normalized.review_result == REVIEW_GREEN:
            user_profile.id_document_type = normalized.document_type
            user_profile.id_document_country = normalized.document_country

        was_verified = user_profile.is_id_verified

        if normalized.review_result == REVIEW_GREEN and not user_profile.is_id_verified:
            user_profile.is_id_verified = True
            user_profile.verified_at = timezone.now()
            logger.info(f"User {user_profile.user_id} verified successfully")
        elif normalized.review_result in [REVIEW_RED, REVIEW_YELLOW]:
            user_profile.is_id_verified = False
            user_profile.verified_at = None

        if was_verified and not user_profile.is_id_verified and user_account is not None:
            if Operator.configured().investor_kyc_required:
                enqueue_for_account(
                    user_account.pk,
                    actor,
                    cause=WhitelistInvalidationCause.IDENTITY_LOSS,
                    cause_fields=["is_id_verified"],
                )

        user_profile.save()

        if normalized.review_result == REVIEW_GREEN and not was_verified:
            _process_verified_customer(user_profile, normalized.pep_data, user_account, actor)

        message = REVIEW_OUTCOME_MESSAGES.get(normalized.review_result)
        if message and normalized.review_result != previous_result:

            from users.tasks.notifications import send_push_notification

            title, body = message
            defer(
                send_push_notification,
                user_id=str(user_profile.user_id),
                title=title,
                body=body,
                data={"type": "identity", "event": normalized.review_result},
                notification_type="general",
            )

    return user_profile.is_id_verified


def _process_verified_customer(user_profile, pep_data: Dict[str, Any], user_account, actor) -> None:
    from compliance.constants import (
        FATF_BLACKLIST_COUNTRIES,
        PEP_REJECTION_TYPES,
        PEP_TYPE_UNKNOWN,
    )
    from users.constants import (
        ACCOUNT_STATUS_ACTIVE,
        ACCOUNT_STATUS_PENDING,
        ACCOUNT_STATUS_REJECTED,
    )

    pep_type = pep_data.get("pep_type", "none")

    if not user_account:
        logger.warning(f"No user_account found for user_profile {user_profile.uuid}")
        return

    allowed_statuses = (
        (ACCOUNT_STATUS_ACTIVE,)
        if Operator.configured().investor_kyc_required
        else (ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING)
    )

    uncleared_unknown = pep_type == PEP_TYPE_UNKNOWN and (
        user_profile.kyc_provider != PROVIDER_SUMSUB or pep_data.get("approved_by_provider") is not True
    )
    if pep_type in PEP_REJECTION_TYPES or uncleared_unknown:
        if user_account.account_status in allowed_statuses:
            enqueue_for_account(user_account.pk, actor, cause_fields=["account_status"])
        user_account.account_status = ACCOUNT_STATUS_REJECTED
        user_account.rejection_reason = "pep_policy"
        user_account.save()
        logger.info(f"Account {user_account.uuid} rejected: PEP type {pep_type}")
        return

    citizenship = user_profile.citizenship_country
    if citizenship and citizenship.code and citizenship.code.upper() in FATF_BLACKLIST_COUNTRIES:
        if user_account.account_status in allowed_statuses:
            enqueue_for_account(user_account.pk, actor, cause_fields=["account_status"])
        user_account.account_status = ACCOUNT_STATUS_REJECTED
        user_account.rejection_reason = "fatf_blacklist"
        user_account.save()
        logger.info(f"Account {user_account.uuid} rejected: FATF black-list country {citizenship.code}")
        return

    user_account.account_status = ACCOUNT_STATUS_ACTIVE
    user_account.save()

    _trigger_risk_assessment(user_account, pep_data)


def _trigger_risk_assessment(user_account, pep_data: Dict[str, Any]) -> None:
    from compliance.services.risk_assessment import RiskAssessmentService

    try:

        with atomic():
            RiskAssessmentService.calculate_and_create(user_account=user_account, pep_data=pep_data)
        logger.info(f"Triggered risk assessment for account {user_account.uuid}")
    except Exception as e:
        logger.error(
            f"Error triggering risk assessment for account {user_account.uuid}: {e}",
            exc_info=True,
        )


def populate_profile(user_profile: UserProfile, extracted_data: Dict[str, Optional[str]]) -> bool:
    with use_operator(), atomic():
        if lock_active_profile(user_profile) is None:
            return False
        changed = []
        for field, key in (
            ("full_name", "fullName"),
            ("residential_address", "address"),
            ("date_of_birth", "dateOfBirth"),
            ("residence_country", "residenceCountry"),
        ):
            value = extracted_data.get(key)
            if value and not getattr(user_profile, field):
                setattr(
                    user_profile,
                    field,
                    Country.get_or_create_for_code(value) if field == "residence_country" else value,
                )
                changed.append(field)
        if changed:
            user_profile.save(update_fields=[*changed, "updated_at"])
        return bool(changed)
