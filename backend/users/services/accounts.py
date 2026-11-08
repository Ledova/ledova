from django.shortcuts import get_object_or_404


def account_of(user):
    profile = getattr(user, "userprofile", None) if user is not None and user.is_authenticated else None
    return getattr(profile, "user_account", None)


def lock_active_user(user):
    return get_object_or_404(user.__class__.objects.select_for_update(no_key=True), pk=user.pk, is_active=True)
