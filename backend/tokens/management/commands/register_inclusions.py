import json
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from shared.db import use_operator
from tokens.services.register_inclusions import classified_inclusions


class Command(BaseCommand):
    help = (
        "Classify completed issuance and settlement inclusions against a share class's captured opening boundary. "
        "Reads no provider and writes nothing."
    )

    def add_arguments(self, parser):
        parser.add_argument("--token", required=True, type=UUID)

    def handle(self, *args, **options):
        try:
            with use_operator():
                result = classified_inclusions(options["token"])
        except APIException as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(json.dumps(result, sort_keys=True))
