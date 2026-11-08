import logging

from django.contrib.auth import authenticate, get_user_model
from django.db import IntegrityError
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed

from authentication.email import EmailError, normalize_email
from authentication.managers.user import EmailLookupState
from authentication.services.email_codes import EmailCodeService
from authentication.services.email_lookup import find_unique_user
from authentication.services.tokens import TokenService
from shared.db import atomic
from shared.db.principal import set_principal

User = get_user_model()
logger = logging.getLogger(__name__)


def resolve_signup_email(email):
    try:
        destination_key = normalize_email(email)
    except EmailError:
        raise serializers.ValidationError({"email": ["Enter a valid email address."]}) from None
    return destination_key, User.objects.resolve_email(destination_key)


def _create_signup_user(email, password):
    try:
        with atomic():
            return User.objects.create_user(email=email, password=password, is_active=True)
    except (IntegrityError, ValueError):
        raise serializers.ValidationError({"email": ["Email already registered"]}) from None


class SessionService:
    @staticmethod
    @atomic()
    def login(email, password):
        if not email or not password:
            raise serializers.ValidationError({"error": ["Email and password are required."]})

        try:
            destination = normalize_email(email)
            candidate = User.objects.resolve_email(destination).user
        except EmailError:
            raise serializers.ValidationError({"error": ["Invalid email or password."]}) from None
        locked = (
            User.objects.select_for_update().filter(pk=candidate.pk, email=destination, is_active=True).first()
            if candidate is not None
            else None
        )
        user = authenticate(username=destination, password=password)
        if user is None or locked is None or user.pk != locked.pk:
            raise serializers.ValidationError({"error": ["Invalid email or password."]})

        set_principal(user.pk)

        if not user.is_active:
            raise serializers.ValidationError({"error": ["User account is disabled."]})

        if not hasattr(user, "userprofile"):
            raise serializers.ValidationError({"error": ["Your signup profile is unavailable."]})
        if not user.userprofile.is_signup_completed and not user.is_email_verified:
            raise serializers.ValidationError({"error": ["Verify your email before continuing signup."]})

        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])

        logger.info(f"User {user.pk} successfully authenticated")
        return user, *TokenService.issue(user)

    @staticmethod
    def verify_email(email, token):
        session = None
        with atomic():
            candidate = find_unique_user(email)
            user = (
                User.objects.select_for_update().filter(pk=candidate.pk, email=email, is_active=True).first()
                if candidate is not None
                else None
            )
            if user is not None and EmailCodeService.verify(user, token):
                set_principal(user.pk)
                session = (user, *TokenService.issue(user))
        if session is None:
            raise serializers.ValidationError({"token": ["Invalid email or verification code."]})
        return session

    @staticmethod
    @atomic()
    def change_password(*, user_id, session_jti, current_password, new_password):
        user = User.objects.select_for_update().filter(pk=user_id, is_active=True).first()
        if user is None or not TokenService.is_session_live(session_jti):
            raise AuthenticationFailed("Your session has expired. Sign in again.")
        if not user.check_password(current_password):
            raise serializers.ValidationError({"current_password": ["Current password is incorrect."]})
        user.set_password(new_password)
        user.save(update_fields=["password"])
        TokenService.revoke_all(user, keep_jti=session_jti)

    @staticmethod
    @atomic()
    def signup(email, password, password_confirmation):
        if not email or not password:
            raise serializers.ValidationError({"error": ["Email and password are required."]})

        if password != password_confirmation:
            raise serializers.ValidationError({"password": ["Passwords do not match."]})

        email, lookup = resolve_signup_email(email)
        if lookup.state is EmailLookupState.AMBIGUOUS:
            raise serializers.ValidationError({"email": ["Email already registered"]})
        existing_user = lookup.user
        if existing_user:
            set_principal(existing_user.pk)
            if not existing_user.is_active or not existing_user.check_password(password):
                raise serializers.ValidationError({"email": ["Email already registered"]})
        if existing_user and hasattr(existing_user, "userprofile") and existing_user.userprofile.is_signup_completed:
            raise serializers.ValidationError({"email": ["Email already registered"]})

        user = existing_user or _create_signup_user(email, password)
        set_principal(user.pk)

        from users.services.setup import ensure_defaults

        ensure_defaults(user)

        logger.info(f"User account created/updated for user {user.pk}")
        return user

    @staticmethod
    def logout(refresh_token=None, refresh_jti=None):
        if refresh_token:
            TokenService.revoke(refresh_token)
        elif refresh_jti:
            TokenService.revoke_jti(refresh_jti)
