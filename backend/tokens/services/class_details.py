from contextlib import contextmanager

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound

from tokens.models import ClassDetailsRevision, ShareToken
from tokens.services.register_authority import register_command


@contextmanager
def class_details_history(*, actor, token):
    with register_command(actor, token.company_id, "class_details_history") as (
        company,
        current_actor,
        profile,
        operator,
    ):
        if not current_actor.is_active or not current_actor.is_email_verified:
            raise NotFound("Share class not found.")
        token = get_object_or_404(
            ShareToken.objects.register_readable_by(current_actor).select_for_update(), pk=token.pk, company=company
        )
        yield ClassDetailsRevision.objects.filter(token=token)
