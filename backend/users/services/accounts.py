from users.models import NotificationPreferences


def account_of(user):
    profile = getattr(user, "userprofile", None) if user is not None and user.is_authenticated else None
    return getattr(profile, "user_account", None)


def ensure_notification_preferences(user_profile):
    preferences, _ = NotificationPreferences.objects.get_or_create(user_profile=user_profile)
    return preferences
