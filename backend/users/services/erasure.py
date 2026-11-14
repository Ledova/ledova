from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.db.models.deletion import Collector, ProtectedError, RestrictedError
from django.template.loader import render_to_string
from django.utils import timezone

from compliance.models import ComplianceAlert
from integrations.kyc.constants import PROVIDER_KYCAID
from integrations.sendgrid_email import sendgrid_client
from shared.db import atomic, current_alias, use_operator
from users.models import AccountErasureWorkItem, UserAccount, UserProfile
from users.services.accounts import lock_active_profile


def identity_retention_case(account):
    if account is None:
        return None
    return (
        ComplianceAlert.objects.filter(user_account=account)
        .filter(Q(smr_required=True) | Q(smr_filed_at__isnull=False))
        .order_by("created_at", "pk")
        .first()
    )


def queue_provider_erasure(user, provider, applicant_id, completion_email):
    if not applicant_id:
        return None
    with use_operator(), atomic():
        account = UserAccount.objects.select_for_update(no_key=True).filter(user_profile__user_id=user.pk).first()
        user = get_user_model().objects.select_for_update(no_key=True).get(pk=user.pk)
        UserProfile.objects.select_for_update(no_key=True).filter(user_id=user.pk).first()
        field = "kycaid_applicant_id" if provider == PROVIDER_KYCAID else "sumsub_applicant_id"
        if UserProfile.objects.filter(**{field: applicant_id}).exclude(user=user).exists():
            return None
        if (
            AccountErasureWorkItem.objects.filter(provider=provider, applicant_id=applicant_id)
            .exclude(user=user)
            .exists()
        ):
            return None
        if completion_email.endswith("@deleted.invalid"):
            completion_email = ""
        held_case = identity_retention_case(account)
        hold_reason = f"Review identity retention for flagged or filed case {held_case.pk}" if held_case else ""
        item, _ = AccountErasureWorkItem.objects.get_or_create(
            user=user,
            provider=provider,
            applicant_id=applicant_id,
            defaults={
                "completion_email": completion_email,
                "hold_reason": hold_reason,
                "review_due_at": timezone.now() + timedelta(days=30) if hold_reason else None,
            },
        )
        if hold_reason and not item.hold_reason:
            item.hold_reason = hold_reason
            item.review_due_at = timezone.now() + timedelta(days=30)
            item.save(update_fields=["hold_reason", "review_due_at", "updated_at"])
        return item


def complete_provider_erasure(identifier, reference, hold_release_reference="", *, confirm_unused_profile=False):
    reference = reference.strip()
    if not reference or len(reference) > 255 or "\n" in reference or "\r" in reference:
        raise ValueError("Use a provider confirmation reference, without personal information or payloads.")
    with use_operator(), atomic():
        item = AccountErasureWorkItem.objects.get(pk=identifier)
        account = UserAccount.objects.select_for_update(no_key=True).filter(user_profile__user_id=item.user_id).first()
        user = get_user_model().objects.select_for_update(no_key=True).get(pk=item.user_id)
        profile = UserProfile.objects.select_for_update(no_key=True).filter(user_id=user.pk).first()
        item.refresh_from_db(from_queryset=AccountErasureWorkItem.objects.select_for_update())
        if item.completed_at is not None:
            return item
        field = "kycaid_applicant_id" if item.provider == PROVIDER_KYCAID else "sumsub_applicant_id"
        if user.is_active:
            if profile is not None and getattr(profile, field) == item.applicant_id:
                raise ValueError("This is the active account's current provider profile; it must not be deleted.")
            if not confirm_unused_profile:
                raise ValueError(
                    "Confirm --confirm-unused-profile for an unused provider profile on an active account."
                )
        if item.hold_reason or identity_retention_case(account) is not None:
            if not hold_release_reference.strip():
                raise ValueError("Resolve the specific retention hold and provide --release-hold-reference first.")
            reference += f"; hold released: {hold_release_reference.strip()}"
            if len(reference) > 255 or "\n" in reference or "\r" in reference:
                raise ValueError(
                    "Use short opaque confirmation and hold-release references, without personal information."
                )
        if item.completion_email:
            message = (
                f"The {item.get_provider_display()} verification profile covered by this erasure confirmation "
                "has been permanently deleted by the provider. Other provider profiles and company-held "
                "records remain separate and are retained only for their stated purpose. "
                "Contact hello@ledova.io for questions."
            )
            result = sendgrid_client.send_email(
                to_email=item.completion_email,
                subject="Ledova verification-data deletion completed",
                html_content=render_to_string("email/verification_data_deleted.html", {"message": message}),
                text_content=message,
            )
            if result.get("success") is not True:
                raise ValueError("Confirmation email was not accepted; the item remains pending.")
        item.applicant_id = ""
        item.completion_email = ""
        item.confirmation_reference = reference
        item.hold_reason = ""
        item.review_due_at = None
        item.completed_at = timezone.now()
        item.save(
            update_fields=[
                "applicant_id",
                "completion_email",
                "confirmation_reference",
                "completed_at",
                "hold_reason",
                "review_due_at",
                "updated_at",
            ]
        )
        return item


def purge_abandoned_signups(now=None):
    from users.services.lifecycle import delete_account

    cutoff = (now or timezone.now()) - timedelta(days=30)
    removed = 0
    with use_operator():
        candidates = (
            UserProfile.objects.filter(
                is_signup_completed=False,
                updated_at__lt=cutoff,
                user__date_joined__lt=cutoff,
                kycaid_applicant_id__isnull=True,
                sumsub_applicant_id__isnull=True,
            )
            .filter(Q(user__last_login__isnull=True) | Q(user__last_login__lt=cutoff))
            .exclude(user__email__endswith="@deleted.invalid")
            .order_by("created_at", "pk")
            .iterator(chunk_size=100)
        )
        for profile in candidates:
            with atomic():
                user = lock_active_profile(profile)
                if (
                    user is None
                    or profile.is_signup_completed
                    or profile.updated_at >= cutoff
                    or user.date_joined >= cutoff
                    or (user.last_login is not None and user.last_login >= cutoff)
                ):
                    continue
                if profile.kycaid_applicant_id or profile.sumsub_applicant_id:
                    continue
                if AccountErasureWorkItem.objects.filter(user=user).exists():
                    continue
                try:
                    collector = Collector(using=current_alias())
                    collector.collect([user])
                except (ProtectedError, RestrictedError):
                    continue
                account = getattr(profile, "user_account", None)
                if account is not None and account.wallets.exists():
                    continue
                delete_account(user, automated=True)
                removed += 1
                if removed >= 100:
                    break
    return removed
