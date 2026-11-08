from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shared.db import use_operator
from users.models import AccountErasureWorkItem
from users.services.erasure import complete_provider_erasure


class Command(BaseCommand):
    help = "List provider-erasure work or record confirmed permanent deletion; never deactivates a provider profile."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["list", "show", "complete"])
        parser.add_argument("--work-item", type=UUID)
        parser.add_argument("--overdue", action="store_true")
        parser.add_argument(
            "--reference", help="Opaque provider permanent-deletion confirmation reference; no personal data."
        )
        parser.add_argument("--confirm-permanent-deletion", action="store_true")
        parser.add_argument(
            "--release-hold-reference",
            help="Opaque authorisation reference resolving this item's specific retention hold.",
        )

    def handle(self, *args, **options):
        with use_operator():
            items = AccountErasureWorkItem.objects.filter(completed_at__isnull=True).order_by("created_at", "pk")
            if options["action"] == "list":
                for item in items.iterator():
                    if not options["overdue"] or item.due_at <= timezone.now():
                        self.stdout.write(
                            f"{item.pk} {item.provider} requested={item.created_at.isoformat()} "
                            f"due={item.due_at.isoformat()} held={bool(item.hold_reason)}"
                        )
                return
            if options["work_item"] is None:
                raise CommandError("Choose --work-item from the pending list.")
            try:
                item = AccountErasureWorkItem.objects.get(pk=options["work_item"])
                if options["action"] == "show":
                    self.stdout.write(
                        f"{item.pk} {item.provider} applicant={item.applicant_id} due={item.due_at.isoformat()} "
                        f"hold={item.hold_reason} review={item.review_due_at}"
                    )
                    return
                if not options["confirm_permanent_deletion"] or not options["reference"]:
                    raise CommandError("Require a permanent-deletion confirmation and --reference from the provider.")
                item = complete_provider_erasure(item.pk, options["reference"], options["release_hold_reference"] or "")
            except (AccountErasureWorkItem.DoesNotExist, ValueError) as error:
                raise CommandError(str(error)) from error
            self.stdout.write(f"{item.pk} completed={item.completed_at.isoformat()}; applicant and contact cleared")
