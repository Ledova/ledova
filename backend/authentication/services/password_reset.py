import logging
from smtplib import SMTPException
from urllib.parse import urlencode, urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ImproperlyConfigured
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import BadHeaderError
from django.core.validators import URLValidator
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework.exceptions import ValidationError

from authentication.services.email_lookup import find_unique_user
from authentication.services.tokens import TokenService
from integrations.sendgrid_email import sendgrid_client
from shared.db import atomic, use_operator
from shared.tasks.queue import defer

User = get_user_model()
logger = logging.getLogger(__name__)

REQUEST_MESSAGE = "If an eligible account exists, a password reset email will be sent."
INVALID_RESET = "This password reset link is invalid or has expired. Request a new link."
RESET_MESSAGE = "Password reset. Sign in with your new password."


def reset_account_id(uid):
    try:
        value = urlsafe_base64_decode(uid).decode("ascii")
        if not value.isdecimal() or len(value) > 19:
            return None
        identifier = int(value)
        return identifier if 0 < identifier < 2**63 else None
    except (ValueError, TypeError, UnicodeError, OverflowError):
        return None


def _eligible(user):
    return user is not None and user.is_active and user.is_email_verified and user.has_usable_password()


def queue_password_reset(email):
    from authentication.tasks import send_password_reset_email

    defer(send_password_reset_email, email=email)


def _reset_url(user):
    origin = settings.DASHBOARD_BASE_URL.rstrip("/")
    try:
        URLValidator()(origin)
        parsed = urlsplit(origin)
    except (ValueError, DjangoValidationError):
        raise ImproperlyConfigured("Password reset email is unavailable.") from None
    local = settings.DEBUG and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        (parsed.scheme != "https" and not local)
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ImproperlyConfigured("Password reset email is unavailable.")
    proof = urlencode(
        {"uid": urlsafe_base64_encode(force_bytes(user.pk)), "token": default_token_generator.make_token(user)}
    )
    return f"{origin}/reset-password#{proof}"


def deliver_password_reset(email):
    with use_operator():
        user = find_unique_user(email)
        if not _eligible(user):
            return
        try:
            reset_url = _reset_url(user)
            html = render_to_string("email/reset_password.html", {"reset_url": reset_url})
            result = sendgrid_client.send_email(
                to_email=user.email,
                subject="Reset your Ledova password",
                html_content=html,
                text_content=(
                    f"Reset your Ledova password: {reset_url}\n\n"
                    "This link expires in 10 minutes and can be used once. "
                    "If you did not request this, you can ignore this email."
                ),
            )
            if result.get("success") is not True:
                logger.error("Password reset email delivery failed")
        except (OSError, SMTPException, BadHeaderError, ImproperlyConfigured):
            logger.error("Password reset email delivery failed")


def reset_password(*, uid, token, new_password):
    identifier = reset_account_id(uid)
    if identifier is None:
        raise ValidationError({"detail": INVALID_RESET})
    with atomic():
        user = User.objects.select_for_update().filter(pk=identifier).first()
        if not _eligible(user) or not default_token_generator.check_token(user, token):
            raise ValidationError({"detail": INVALID_RESET})
        if not new_password.strip():
            raise ValidationError({"new_password": ["Password may not be blank."]})
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as error:
            raise ValidationError({"new_password": error.messages}) from None
        user.set_password(new_password)
        user.email_verification_token = None
        user.email_verification_attempts = 0
        user.save(update_fields=["password", "email_verification_token", "email_verification_attempts"])
        TokenService.revoke_all(user)
