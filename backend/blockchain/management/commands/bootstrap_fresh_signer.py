import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from blockchain.exceptions import FreshSignerBootstrapError
from blockchain.services.fresh_signer import (
    bootstrap_fresh_signer,
    require_bootstrap_boundary,
)
from shared.db import use_operator


def _unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise FreshSignerBootstrapError("The bootstrap manifest contains duplicate keys.")
        result[key] = value
    return result


class Command(BaseCommand):
    help = "Admit only a fresh Base Sepolia signer after verifying its five finalized bootstrap transactions."

    def add_arguments(self, parser):
        parser.add_argument("--manifest", required=True, type=Path)

    def handle(self, *args, **options):
        try:
            require_bootstrap_boundary()
            manifest = json.loads(options["manifest"].read_text(), object_pairs_hook=_unique_keys)
            with use_operator():
                result = bootstrap_fresh_signer(manifest)
        except FreshSignerBootstrapError as exc:
            raise CommandError(str(exc)) from None
        except (OSError, ValueError):
            raise CommandError("The bootstrap manifest could not be read as valid JSON.") from None
        self.stdout.write(json.dumps(result, sort_keys=True))
