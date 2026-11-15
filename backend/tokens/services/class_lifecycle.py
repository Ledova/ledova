from django.db import connections
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import Company
from shared.db import current_alias
from tokens.exceptions import RegisterChangeConflict
from tokens.models import ShareRegister, ShareToken
from tokens.models.choices import ShareTokenType
from tokens.services.register_authority import register_command
from tokens.services.share_token_service import reserved_symbol


def class_lifecycle_access(token, actor):
    token.can_edit_details = False
    token.can_delete = False
    if actor is not None and Company.objects.register_preparable_by(actor).filter(pk=token.company_id).exists():
        token.can_edit_details, token.can_delete = _available(token.pk)
    return token


def _available(token_id):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_class_details_available(%s, true), tokens_class_details_available(%s, false)",
            [token_id, token_id],
        )
        return cursor.fetchone()


def _current(token, actor, expected_updated_at):
    if not Company.objects.register_preparable_by(actor).filter(pk=token.company_id).exists():
        raise NotFound("A current company administrator or preparer is required to change this share class.")
    token = get_object_or_404(ShareToken.objects.select_for_update(), pk=token.pk, company_id=token.company_id)
    list(ShareRegister.objects.select_for_update().filter(token=token).values_list("pk", flat=True))
    if token.updated_at != expected_updated_at:
        raise RegisterChangeConflict("This share class changed. Review its current details before trying again.")
    return token


def update_class_details(*, actor, token, expected_updated_at, changes):
    if set(changes) != {"name", "symbol", "token_type"}:
        raise ValidationError("Supply only the class name, code and type.")
    name, symbol, token_type = (changes[field] for field in ("name", "symbol", "token_type"))
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name) > 100
        or not isinstance(symbol, str)
        or not symbol.isascii()
        or not symbol.isalpha()
        or not 1 <= len(symbol) <= 5
        or reserved_symbol(symbol)
        or token_type not in ShareTokenType.values
    ):
        raise ValidationError("Supply a valid class name, code and type.")
    changes = {"name": name.strip(), "symbol": symbol.upper(), "token_type": token_type}
    with register_command(actor, token.company_id, "register_class_edit") as (_, current_actor, _profile, _operator):
        token = _current(token, current_actor, expected_updated_at)
        if not _available(token.pk)[0]:
            raise RegisterChangeConflict("Class details can change only before its ledger or dependent records exist.")
        if (
            ShareToken.objects.filter(company_id=token.company_id, symbol=changes["symbol"])
            .exclude(pk=token.pk)
            .exists()
        ):
            raise ValidationError({"symbol": "This class code already exists in the company."})
        for field, value in changes.items():
            setattr(token, field, value)
        token.save(update_fields=["name", "symbol", "token_type", "updated_at"])
        return class_lifecycle_access(token, current_actor)


def delete_unused_class(*, actor, token, expected_updated_at):
    with register_command(actor, token.company_id, "register_class_delete") as (_, current_actor, _profile, _operator):
        token = _current(token, current_actor, expected_updated_at)
        if not _available(token.pk)[1]:
            raise RegisterChangeConflict("Only an unused share class with no retained records can be deleted.")
        token.delete()
