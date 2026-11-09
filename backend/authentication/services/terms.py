from rest_framework.exceptions import ValidationError

from authentication.models import TermsAcceptance
from shared.db import use_operator

TERMS_VERSION = "2026-11-09"
TERMS_STATEMENT = "I accept the Ledova Terms of Service."


def current_terms_receipt(user_id, requester):
    if not requester.is_authenticated or requester.pk != user_id:
        return None
    with use_operator():
        return TermsAcceptance.objects.filter(user_id=user_id, version=TERMS_VERSION, statement=TERMS_STATEMENT).first()


def accept_terms(user):
    if not user.is_active or not user.is_email_verified:
        raise ValidationError({"terms_and_conditions": "Verify your email before accepting the Terms of Service."})
    return TermsAcceptance.objects.get_or_create(
        user=user, version=TERMS_VERSION, defaults={"statement": TERMS_STATEMENT}
    )[0]
