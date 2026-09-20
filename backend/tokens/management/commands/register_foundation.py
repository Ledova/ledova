import json
from datetime import date
from pathlib import Path
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from shared.db import atomic, use_operator
from tokens.exceptions import RegisterIntegrityError
from tokens.models import ShareRegister, ShareToken
from tokens.services.register_events import (
    create_member,
    open_register,
    verify_register,
)


class Command(BaseCommand):
    help = (
        "Load a synthetic register opening or verify stored event and holding integrity. Does not activate API reads."
    )

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["load-synthetic-opening", "verify"])
        parser.add_argument("--token", required=True, type=UUID)
        parser.add_argument("--input", type=Path)
        parser.add_argument("--actor", type=int)

    def handle(self, *args, **options):
        try:
            with use_operator(), atomic():
                token = ShareToken.objects.get(pk=options["token"])
                if options["action"] == "load-synthetic-opening":
                    self.load_opening(token, options)
                register = ShareRegister.objects.get(token=token)
                result = verify_register(register.pk)
        except (ShareToken.DoesNotExist, ShareRegister.DoesNotExist):
            raise CommandError("The requested share class or stored register does not exist.") from None
        except (RegisterIntegrityError, APIException) as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(json.dumps(result, sort_keys=True))

    def load_opening(self, token, options):
        if options["input"] is None or options["actor"] is None:
            raise CommandError("A synthetic opening requires --input and --actor.")
        try:
            actor = get_user_model().objects.get(pk=options["actor"], is_active=True, is_staff=True)
            data = json.loads(options["input"].read_text())
            if not isinstance(data, dict) or set(data) != {"operation_id", "effective_on", "holdings"}:
                raise ValueError
            operation = UUID(data["operation_id"])
            effective = date.fromisoformat(data["effective_on"])
            if not isinstance(data["holdings"], list):
                raise ValueError
            for holding in data["holdings"]:
                if not isinstance(holding, dict) or set(holding) != {"member", "shares"}:
                    raise ValueError
                create_member(company_id=token.company_id, member_id=UUID(holding["member"]))
        except (OSError, ValueError, TypeError, KeyError, get_user_model().DoesNotExist):
            raise CommandError("Provide an active staff actor and a valid synthetic opening file.") from None
        open_register(
            token_id=token.pk,
            operation_id=operation,
            changes=data["holdings"],
            effective_on=effective,
            recorded_by=actor,
        )
