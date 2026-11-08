from shared.db import atomic
from users.services.accounts import lock_active_user


@atomic()
def create_financial_profile(user, serializer):
    lock_active_user(user)
    return serializer.save(user_profile=user.userprofile)
