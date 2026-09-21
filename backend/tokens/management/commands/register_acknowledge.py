import json
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from shared.db import use_operator
from tokens.services.register_reconciliation import acknowledge_discrepancy


class Command(BaseCommand):
    help = (
        "Acknowledge one discrepancy of a share class's latest reconciliation, named by its position, with a reason. "
        "Later reconciliations treat it as explained. Writes only the acknowledgement."
    )

    def add_arguments(self, parser):
        parser.add_argument("--reconciliation", required=True, type=UUID)
        parser.add_argument("--discrepancy", required=True, type=int)
        parser.add_argument("--reason", required=True)
        parser.add_argument("--actor", required=True, type=int)

    def handle(self, *args, **options):
        try:
            with use_operator():
                record = acknowledge_discrepancy(
                    reconciliation_id=options["reconciliation"],
                    index=options["discrepancy"],
                    reason=options["reason"],
                    actor=get_user_model().objects.filter(pk=options["actor"]).first(),
                )
        except APIException as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(
            json.dumps(
                {
                    "acknowledgement": str(record.pk),
                    "reconciliation": str(record.reconciliation_id),
                    "discrepancy": record.discrepancy,
                    "reason": record.reason,
                },
                sort_keys=True,
            )
        )
