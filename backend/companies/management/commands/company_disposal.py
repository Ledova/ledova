import json
from uuid import UUID

from django.core.exceptions import ObjectDoesNotExist
from django.core.management.base import BaseCommand, CommandError

from companies.models import CompanyDisposal
from companies.services.company_disposal import (
    complete_company_disposal,
    dispose_company,
    preview_company_disposal,
)
from shared.db import use_migrate


class Command(BaseCommand):
    help = "Preview or execute reviewed company exit using the separate schema-maintenance credential."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["preview", "dispose", "status", "retry-files"])
        parser.add_argument("--company", type=UUID)
        parser.add_argument("--appointment", type=UUID)
        parser.add_argument("--pack")
        parser.add_argument("--digest")
        parser.add_argument("--authorisation-reference")
        parser.add_argument("--handover-reference")
        parser.add_argument("--purpose-review-reference")
        parser.add_argument("--confirm-company", type=UUID)
        parser.add_argument("--confirm-no-holds", action="store_true")
        parser.add_argument("--confirm-copies-reviewed", action="store_true")
        parser.add_argument("--receipt", type=UUID)

    def handle(self, *args, **options):
        try:
            if options["action"] == "status":
                if not options["receipt"] and not options["company"]:
                    raise ValueError("Provide --receipt or --company to find the disposal receipt.")
                with use_migrate():
                    receipt = CompanyDisposal.objects.get(
                        **({"pk": options["receipt"]} if options["receipt"] else {"company_id": options["company"]})
                    )
            elif options["action"] == "retry-files":
                if not options["receipt"]:
                    raise ValueError("Provide --receipt from the company-disposal result.")
                if not options["confirm_no_holds"] or not options["confirm_copies_reviewed"]:
                    raise ValueError("Review any new holds or instructions and confirm the copies before retrying.")
                receipt = complete_company_disposal(options["receipt"])
            else:
                if not options["company"] or not options["appointment"]:
                    raise ValueError("Provide the exact --company and current administrator --appointment.")
                fields = {
                    "company_id": options["company"],
                    "appointment_id": options["appointment"],
                    "pack": options["pack"],
                }
                if options["action"] == "preview":
                    self.stdout.write(json.dumps(preview_company_disposal(**fields), sort_keys=True))
                    return
                if (
                    options["confirm_company"] != options["company"]
                    or not options["confirm_no_holds"]
                    or not options["confirm_copies_reviewed"]
                ):
                    raise ValueError("Confirm the exact company, no remaining holds, and the reviewed copies.")
                if not all(
                    options[key]
                    for key in (
                        "digest",
                        "authorisation_reference",
                        "handover_reference",
                        "purpose_review_reference",
                    )
                ):
                    raise ValueError(
                        "Require the preview digest and opaque instruction, handover and review references."
                    )
                receipt = dispose_company(
                    **fields,
                    **{
                        key: options[key]
                        for key in (
                            "digest",
                            "authorisation_reference",
                            "handover_reference",
                            "purpose_review_reference",
                        )
                    }
                )
        except (ValueError, ObjectDoesNotExist, OSError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(
            json.dumps(
                {
                    "receipt": str(receipt.pk),
                    "database_disposed": bool(receipt.database_disposed_at),
                    "pending_files": len(receipt.pending_files),
                    "current_storage_complete": bool(receipt.completed_at),
                },
                sort_keys=True,
            )
        )
