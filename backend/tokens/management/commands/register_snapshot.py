import json
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from shared.db import use_operator
from tokens.services.register_snapshot import capture_snapshot


class Command(BaseCommand):
    help = "Inspect a policy-final share snapshot without creating or activating a stored register."

    def add_arguments(self, parser):
        parser.add_argument("--token", required=True, type=UUID)

    def handle(self, *args, **options):
        try:
            with use_operator():
                snapshot = capture_snapshot(options["token"])
        except APIException as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(json.dumps(snapshot, sort_keys=True))
