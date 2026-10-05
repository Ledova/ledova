import logging
from contextlib import contextmanager

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, connections
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import Company, CompanyStatus
from companies.services.authority_requests import _requester_principal
from shared.db import atomic, current_alias, use_operator
from users.models import UserAccount, UserProfile
from users.models.investor_classification import (
    InvestorClassification,
    InvestorClassificationStatus,
)

logger = logging.getLogger(__name__)
CHANGES_LIVENESS = ("verify", "revoke")
EVIDENCE_SETTINGS = (
    "app.classification_evidence_operation",
    "app.classification_evidence_source",
    "app.classification_evidence_document",
    "app.classification_evidence_account",
    "app.classification_evidence_profile",
    "app.classification_evidence_company",
)


@contextmanager
def evidence_operation(
    operation, *, source_id=None, document_id=None, account_id=None, profile_id=None, company_id=None
):
    command_connection = connections[current_alias()]
    values = (operation, source_id, document_id, account_id, profile_id, company_id)
    with command_connection.cursor() as cursor:
        cursor.execute("SELECT " + ", ".join("current_setting(%s, true)" for _ in EVIDENCE_SETTINGS), EVIDENCE_SETTINGS)
        previous = cursor.fetchone()
        for name, value in zip(EVIDENCE_SETTINGS, values):
            cursor.execute("SELECT set_config(%s, %s, false)", [name, str(value) if value is not None else ""])
    try:
        yield
    finally:
        with command_connection.cursor() as cursor:
            for name, value in zip(EVIDENCE_SETTINGS, previous):
                cursor.execute("SELECT set_config(%s, %s, false)", [name, value or ""])


def require_evidence_retention_policy():
    configured = (settings.CLASSIFICATION_EVIDENCE_RETENTION_DAYS, settings.UNATTACHED_DOCUMENT_RETENTION_DAYS)
    if any(type(value) is not int or value < 0 for value in configured):
        raise ImproperlyConfigured("Evidence retention periods must be nonnegative integers.")
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT users_classification_evidence_retention_days(), users_unattached_document_retention_days()"
        )
        installed = cursor.fetchone()
    if tuple(configured) != tuple(installed):
        raise ImproperlyConfigured(
            "Evidence retention configuration changed; install the corresponding guard migration."
        )


def create_classification(*, actor, validated_data):
    if actor is None or not actor.is_authenticated:
        raise NotFound("Account not found.")
    classification = InvestorClassification(**validated_data)
    original_name = classification.evidence_file.name
    try:
        with use_operator(), _requester_principal(actor.pk), atomic():
            if classification.company_id:
                get_object_or_404(
                    Company.objects.select_for_update(no_key=True),
                    pk=classification.company_id,
                    status=CompanyStatus.ACTIVE,
                )
            account = get_object_or_404(
                UserAccount.objects.select_for_update(no_key=True), pk=classification.user_account_id
            )
            profile_id = account.user_profile_id
            if not UserProfile.objects.filter(pk=profile_id, user_id=actor.pk).exists():
                raise NotFound("Account not found.")
            current_actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=actor.pk)
            profile = get_object_or_404(UserProfile.objects.select_for_update(), pk=profile_id, user=current_actor)
            if InvestorClassification.objects.filter(
                user_account=account, status=InvestorClassificationStatus.SUBMITTED
            ).exists():
                raise ValidationError({"user_account": "This account already has a classification awaiting review."})
            with evidence_operation(
                "create",
                source_id=classification.pk,
                account_id=account.pk,
                profile_id=profile.pk,
                company_id=classification.company_id,
            ), atomic():
                classification.save(force_insert=True)
                classification.refresh_from_db()
        return classification
    except (IntegrityError, ValidationError):
        if classification.evidence_file._committed and classification.evidence_file.name != original_name:
            try:
                classification.evidence_file.delete(save=False)
            except Exception:
                logger.error("Classification upload rollback cleanup failed for %s", classification.pk, exc_info=True)
        raise


def withdraw_classification(*, actor, classification_id):
    if actor is None or not actor.is_authenticated:
        raise NotFound("Classification not found.")
    with use_operator(), _requester_principal(actor.pk), atomic():
        captured = (
            InvestorClassification.objects.filter(pk=classification_id, user_account__user_profile__user_id=actor.pk)
            .values("user_account_id")
            .first()
        )
        if captured is None:
            raise NotFound("Classification not found.")
        account = get_object_or_404(UserAccount.objects.select_for_update(no_key=True), pk=captured["user_account_id"])
        profile_id = account.user_profile_id
        if not UserProfile.objects.filter(pk=profile_id, user_id=actor.pk).exists():
            raise NotFound("Classification not found.")
        current_actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=actor.pk)
        profile = get_object_or_404(UserProfile.objects.select_for_update(), pk=profile_id, user=current_actor)
        classification = get_object_or_404(
            InvestorClassification.objects.select_for_update(), pk=classification_id, user_account=account
        )
        if account.user_profile_id != profile.pk:
            raise NotFound("Classification not found.")
        classification._require_status([InvestorClassificationStatus.SUBMITTED], InvestorClassificationStatus.WITHDRAWN)
        with evidence_operation(
            "withdraw", source_id=classification.pk, account_id=account.pk, profile_id=profile.pk
        ), atomic():
            classification.status = InvestorClassificationStatus.WITHDRAWN
            classification.reviewed_at = timezone.now()
            classification.withdrawn_by = current_actor
            classification.save(update_fields=["status", "reviewed_at", "withdrawn_by", "updated_at"])
            classification.refresh_from_db()
        return classification


def transition_classification(classification: InvestorClassification, method: str, **kwargs) -> InvestorClassification:
    from whitelist.services.refresh import enqueue_for_account

    with use_operator(), _requester_principal(kwargs["reviewed_by"].pk), atomic():
        get_object_or_404(get_user_model().objects.select_for_update(), pk=kwargs["reviewed_by"].pk)
        classification.refresh_from_db(from_queryset=InvestorClassification.objects.select_for_update())
        with evidence_operation("review", source_id=classification.pk), atomic():
            getattr(classification, method)(**kwargs)
            classification.refresh_from_db()
        logger.info(f"Investor classification {classification.uuid}: {method} by {kwargs.get('reviewed_by')}")
        if method in CHANGES_LIVENESS:
            enqueue_for_account(classification.user_account_id, kwargs.get("reviewed_by"))
    return classification


def purge_evidence(classification: InvestorClassification) -> bool:
    with use_operator(), evidence_operation("purge_classification", source_id=classification.pk), atomic():
        require_evidence_retention_policy()
        classification = InvestorClassification.objects.select_for_update().get(pk=classification.pk)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT users_classification_evidence_purge_due(%s)", [classification.pk])
            if not cursor.fetchone()[0]:
                return False
        classification.evidence_file.delete(save=False)
        classification.save(update_fields=["evidence_file", "updated_at"])
        return True


def purge_expired_evidence(moment, limit) -> dict:
    purged = failed = 0
    with use_operator():
        require_evidence_retention_policy()
        candidates_at = min(moment, timezone.now())
        ids = list(
            InvestorClassification.objects.evidence_purgeable(candidates_at).values_list("pk", flat=True)[:limit]
        )
        for classification_id in ids:
            try:
                purged += int(purge_evidence(InvestorClassification(pk=classification_id)))
            except Exception:
                failed += 1
                logger.error(f"Evidence purge failed for classification {classification_id}", exc_info=True)
                continue
            logger.info(f"Evidence purge checked for classification {classification_id}")
    return {"purged": purged, "failed": failed}
