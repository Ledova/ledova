def account_of(user):
    profile = getattr(user, "userprofile", None) if user is not None and user.is_authenticated else None
    return getattr(profile, "user_account", None)
