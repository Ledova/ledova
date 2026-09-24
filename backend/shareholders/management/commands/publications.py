import json
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError

from shared.db import atomic, use_operator
from shareholders.exceptions import PublicationIntegrityError
from shareholders.models import Publication, PublicationKind
from shareholders.services.publications import verify_roll
from shareholders.services.resolutions import verify_publication


def _verified(publication):
    result = verify_roll(publication)
    if publication.kind == PublicationKind.RESOLUTION:
        result.update(verify_publication(publication.pk))
    return result


class Command(BaseCommand):
    help = (
        "Verify that a publication's frozen roll still holds the rows and digest it recorded, and that a "
        "resolution's event chain and tally still verify."
    )

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["verify"])
        parser.add_argument("--publication", type=UUID)

    def handle(self, *args, **options):
        try:
            with use_operator(), atomic():
                publications = Publication.objects.all()
                if options["publication"] is not None:
                    publications = publications.filter(pk=options["publication"])
                    if not publications.exists():
                        raise Publication.DoesNotExist
                results = {str(publication.pk): _verified(publication) for publication in publications}
        except Publication.DoesNotExist:
            raise CommandError("The requested publication does not exist.") from None
        except PublicationIntegrityError as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(json.dumps(results, sort_keys=True))
