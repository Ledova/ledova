import json

from django.core.management.base import BaseCommand, CommandError

from blockchain.exceptions import LocalSignerAdmissionError
from blockchain.services.local_signer import admit_local_signer, require_local_boundary
from shared.db import use_operator


class Command(BaseCommand):
    help = (
        "Admit the configured operator signer on the local development chain (31337) and nowhere else. "
        "Idempotent; refuses a signer that was closed, and a chain missing transactions the database recorded."
    )

    def handle(self, *args, **options):
        try:
            require_local_boundary()
            with use_operator():
                result = admit_local_signer()
        except LocalSignerAdmissionError as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(json.dumps(result, sort_keys=True))
