from shared.db import atomic
from users.models import UserPreferences, UserProfile


@atomic()
def upsert_user_preferences(user, fields):
    user_profile = _profile_locked_against_a_concurrent_upsert(user)
    existing = UserPreferences.objects.filter(user_profile=user_profile).first()

    if existing is None:
        return UserPreferences.objects.create(user_profile=user_profile, **fields)

    for name, value in fields.items():
        setattr(existing, name, value)
    existing.save(update_fields=[*fields, "updated_at"])
    return existing


def _profile_locked_against_a_concurrent_upsert(user):
    return UserProfile.objects.select_for_update().get(user=user)
