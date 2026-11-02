import json

from django.db import connections
from rest_framework.exceptions import ValidationError

from companies.models import CompanyCapability
from companies.services.administration import company_operation, lock_company_actor
from shared.db import atomic, current_alias
from tokens.exceptions import RegisterIntegrityError
from tokens.models import (
    RegisterExportRoute,
    RegisterImport,
    RegisterMember,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.company_pack import _build_company_pack, _record
from tokens.services.register_authority import register_appointment

UNSUPPORTED = (
    "Company download supports complete non-tokenised core register packs. This captured pack contains "
    "other records whose existing access rules do not permit company download, so no pack was produced."
)


def _require_core_contents(company, classes, approvals, mandate_source):
    restrictive = (
        "wallet_nominations",
        "wallet_instructions",
        "wallet_links",
        "instructions",
        "deployments",
        "capital_increases",
        "pause_changes",
    )
    if approvals["approvals"] or approvals["changes"] or any(mandate_source[family] for family in restrictive):
        raise ValidationError(UNSUPPORTED)
    for share_class in classes:
        token = share_class["token"]
        folder = f"classes/{token.pk}"
        records = {
            name: json.loads(share_class["files"][f"{folder}/{name}.json"])
            for name in ("class", "chain", "issues", "settlements", "entries")
        }
        details = records["class"]
        if (
            not RegisterImport.objects.filter(company=company, token=token, status="applied").exists()
            or token.status != ShareTokenStatus.DRAFT
            or token.contract_address
            or token.deployment_id
            or token.deployment_transaction_id
            or token.deployment_tx_hash
            or token.deployed_at
            or token.chain
            or records["chain"]["deployment"] is not None
            or records["chain"]["operations"]
            or records["issues"]["issues"]
            or records["settlements"]
            or details["cap_increases"]
            or details["pauses"]
        ):
            raise ValidationError(UNSUPPORTED)
        register = ShareRegister.objects.filter(token=token).first()
        members = {change["member"] for entry in records["entries"] for change in entry["changes"]}
        if (
            token.company_id != company.pk
            or register is None
            or register.company_id != company.pk
            or RegisterMember.objects.filter(pk__in=members, company=company).count() != len(members)
        ):
            raise RegisterIntegrityError("The captured register's company binding is inconsistent.")


def prepare_company_pack(*, actor, company_id, appointment, instruction, recipient):
    with company_operation(actor, company_id, "company_pack"):
        if connections[current_alias()].in_atomic_block:
            raise ValidationError("Produce a company pack outside an existing transaction.")
        with atomic(durable=True):
            company, actor, profile, operator = lock_company_actor(actor, company_id)
            register_appointment(company, actor, profile, operator, appointment, CompanyCapability.ADMIN)
        archive, filename, classes, digest = _build_company_pack(
            company, instruction=instruction, recipient=recipient, validate_contents=_require_core_contents
        )
        try:
            with atomic(durable=True):
                company, actor, profile, operator = lock_company_actor(actor, company_id)
                register_appointment(company, actor, profile, operator, appointment, CompanyCapability.ADMIN)
                class_ids = [share_class["token"].pk for share_class in classes]
                locked = list(
                    ShareToken.objects.select_for_update().filter(pk__in=class_ids, company=company).order_by("uuid")
                )
                if len(locked) != len(class_ids):
                    raise ValidationError("A captured share class no longer belongs to this company.")
                _record(classes, actor, digest, instruction, recipient, RegisterExportRoute.COMPANY)
                register_appointment(company, actor, profile, operator, appointment, CompanyCapability.ADMIN)
        except BaseException:
            archive.close()
            raise
        return archive, filename
