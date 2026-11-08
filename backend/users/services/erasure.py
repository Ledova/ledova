from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.db.models.deletion import Collector, ProtectedError, RestrictedError
from django.utils import timezone

from integrations.sendgrid_email import sendgrid_client
from shared.db import atomic, current_alias, use_operator
from users.models import AccountErasureWorkItem, UserProfile
from users.services.accounts import lock_active_profile


def queue_provider_erasure(user, provider, applicant_id, completion_email, hold_reason=""):
    if applicant_id:
        AccountErasureWorkItem.objects.get_or_create(
            user=user,
            provider=provider,
            applicant_id=applicant_id,
            defaults={
                "completion_email": completion_email,
                "hold_reason": hold_reason,
                "review_due_at": timezone.now() + timedelta(days=30) if hold_reason else None,
            },
        )


def complete_provider_erasure(identifier, reference, hold_release_reference=""):
    reference = reference.strip()
    if not reference or len(reference) > 255 or "\n" in reference or "\r" in reference:
        raise ValueError("Use a provider confirmation reference, without personal information or payloads.")
    with use_operator(), atomic():
        item = AccountErasureWorkItem.objects.select_for_update().get(pk=identifier)
        if item.completed_at is not None:
            return item
        if item.hold_reason:
            if not hold_release_reference.strip():
                raise ValueError("Resolve the specific retention hold and provide --release-hold-reference first.")
            reference += f"; hold released: {hold_release_reference.strip()}"
            if len(reference) > 255 or "\n" in reference or "\r" in reference:
                raise ValueError(
                    "Use short opaque confirmation and hold-release references, without personal information."
                )
        if get_user_model().objects.filter(pk=item.user_id, is_active=True).exists():
            raise ValueError("Provider erasure is only for a closed account.")
        if item.completion_email:
            message = (
                f"The {item.get_provider_display()} verification data covered by your Ledova account-deletion "
                "request has been permanently deleted by the provider. Company-held records remain separate "
                "and are retained only for their stated purpose. Contact hello@ledova.io for questions."
            )
            result = sendgrid_client.send_email(
                to_email=item.completion_email,
                subject="Ledova verification-data deletion completed",
                html_content=f"<p>{message}</p>",
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
        candidates = list(
            UserProfile.objects.filter(
                is_signup_completed=False,
                updated_at__lt=cutoff,
                user__date_joined__lt=cutoff,
                kycaid_applicant_id__isnull=True,
                sumsub_applicant_id__isnull=True,
            )
            .filter(Q(user__last_login__isnull=True) | Q(user__last_login__lt=cutoff))
            .exclude(user__email__endswith="@deleted.invalid")
            .order_by("created_at", "pk")[:100]
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
    return removed
