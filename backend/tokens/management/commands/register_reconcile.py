import json
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from shared.db import use_operator
from tokens.services.register_reconciliation import reconcile_register


class Command(BaseCommand):
    help = (
        "Reconcile a share class's stored register with a fresh canonical chain snapshot and record the result. "
        "Reads the provider and writes only the reconciliation record."
    )

    def add_arguments(self, parser):
        parser.add_argument("--token", required=True, type=UUID)

    def handle(self, *args, **options):
        try:
            with use_operator():
                record = reconcile_register(options["token"])
        except APIException as exc:
            raise CommandError(str(exc)) from None
        if record is None:
            raise CommandError("The share class has no applied register opening to reconcile against.")
        self.stdout.write(
            json.dumps(
                {
                    "reconciliation": str(record.pk),
                    "status": record.status,
                    "block": record.block_number,
                    "register_sequence": record.register_sequence,
                    "discrepancies": record.discrepancies,
                    "failure": record.failure,
                },
                sort_keys=True,
            )
        )
