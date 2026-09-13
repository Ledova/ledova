from compliance.services.risk_assessment import RiskAssessmentService
from shared.db import atomic
from users.models import NotificationPreferences


@atomic()
def register_account(account):
    RiskAssessmentService.create_pending_assessment(user_account=account)
    return account


def ensure_notification_preferences(user_profile):
    preferences, _ = NotificationPreferences.objects.get_or_create(user_profile=user_profile)
    return preferences
