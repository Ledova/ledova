from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404

from users.models import UserAccount, UserProfile


def account_of(user):
    profile = getattr(user, "userprofile", None) if user is not None and user.is_authenticated else None
    return getattr(profile, "user_account", None)


def lock_active_user(user):
    return get_object_or_404(user.__class__.objects.select_for_update(no_key=True), pk=user.pk, is_active=True)


def lock_active_profile(profile):
    UserAccount.objects.select_for_update(no_key=True).filter(user_profile_id=profile.pk).first()
    user = get_user_model().objects.select_for_update(no_key=True).filter(pk=profile.user_id, is_active=True).first()
    if user is not None:
        profile.refresh_from_db(from_queryset=UserProfile.objects.select_for_update(no_key=True))
    return user
