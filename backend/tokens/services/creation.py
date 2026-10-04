from django.contrib.auth import get_user_model
from rest_framework.exceptions import PermissionDenied, ValidationError

from companies.models import Company
from companies.services.authority_requests import _requester_principal
from shared.db import atomic, use_operator
from tokens.models import ShareToken

CREATE_FIELDS = frozenset(
    {"name", "symbol", "token_type", "total_supply", "decimals", "is_transferable", "is_divisible"}
)


def create_share_token(*, actor, company_id, data):
    if actor is None or not actor.is_authenticated:
        raise PermissionDenied("You must be associated with a company to create tokens.")
    if set(data) - CREATE_FIELDS:
        raise ValidationError("Only the validated share-class creation fields may be supplied.")
    with use_operator(), _requester_principal(actor.pk), atomic():
        company = Company.objects.select_for_update().owned_by(actor).filter(pk=company_id).first()
        current_actor = get_user_model().objects.select_for_update().filter(pk=actor.pk, is_active=True).first()
        if company is None or current_actor is None:
            raise PermissionDenied("You must be associated with a company to create tokens.")
        return ShareToken.objects.create(company=company, **data)
