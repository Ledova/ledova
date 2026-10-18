from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from companies.models import Company
from tokens.models import ShareToken
from tokens.services.register_authority import register_command

CREATE_FIELDS = frozenset(
    {"name", "symbol", "token_type", "total_supply", "decimals", "is_transferable", "is_divisible"}
)


def create_share_token(*, actor, company_id, data):
    if actor is None or not actor.is_authenticated:
        raise PermissionDenied("You must be associated with a company to create tokens.")
    if set(data) - CREATE_FIELDS:
        raise ValidationError("Only the validated share-class creation fields may be supplied.")
    with register_command(actor, company_id, "register_class_create") as (company, current_actor, _profile, _operator):
        if not Company.objects.register_preparable_by(current_actor).filter(pk=company.pk).exists():
            raise NotFound("A current company administrator or preparer is required to create this share class.")
        return ShareToken.objects.create(company=company, **data)
