from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission

from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import attach_file, make_document
from offerings.models import Subscription
from tokens.models import SwapOrder
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.tests.test_register_events import register_fixture

DIRECTOR = "Synthetic Director"


def instruction_reviewer():
    reviewer = get_user_model().objects.create_user(
        email=f"instruction-{uuid4()}@example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registerinstruction", "view_registerinstruction"]
        )
    )
    return reviewer


def verified_authority(company, reviewer):
    document = attach_file(make_document(company))
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    return verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)


def instruction_company():
    owner, company, _, _, _, _ = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    return owner, company, verified_authority(company, instruction_reviewer())


def instruction_item(row):
    if isinstance(row, SwapOrder):
        return {
            "settlement": str(row.pk),
            "seller": row.seller_address,
            "buyer": row.buyer_address,
            "amount": str(row.share_amount),
        }
    if isinstance(row, Subscription):
        request = row.issuance_request
        recipient, amount = (
            (request.recipient_address, request.amount) if request else (row.wallet.address, row.allotment_quantity)
        )
        return {"subscription": str(row.pk), "recipient": recipient, "amount": str(amount)}
    return {"request": str(row.pk), "recipient": row.recipient_address, "amount": str(row.amount)}


def instruction_payload(token, document, rows, **changes):
    return {
        "operation_id": uuid4(),
        "token_id": token.pk,
        "document_id": document.pk,
        "kind": "transfer" if any(isinstance(row, SwapOrder) for row in rows) else "issue",
        "items": [instruction_item(row) for row in rows],
        "approving_director": DIRECTOR,
        "authority_reference": "SYNTHETIC-RESOLUTION-ISSUE-1",
        "reason": "Allot the listed shares",
        **changes,
    }


def apply_instruction(token, *rows, reviewer=None, document=None):
    reviewer = reviewer or instruction_reviewer()
    document = document or verified_authority(token.company, reviewer)
    proposal = submit_instruction(actor=token.company.owner, **instruction_payload(token, document, rows))
    _, _, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=reviewer)
    return decide_instruction(proposal_id=proposal.pk, reviewer=reviewer, confirmation=confirmation, decision="apply")


def retained_approved_request(token, recipient_address, *, reviewer=None, notes="", **fields):
    from shared.tests.schema import migrate_to, restore_every_migration
    from tokens.models import ShareIssuanceRequest

    reviewer = reviewer or instruction_reviewer()
    try:
        migrate_to([("tokens", "0099_company_register_deployment_guards")])
        request = ShareIssuanceRequest.objects.create(
            token=token,
            recipient_address=recipient_address,
            amount=fields.pop("amount", 10),
            recipient_name=fields.pop("recipient_name", "Retained recipient"),
            reason="Retained predecessor approval",
            submitted_by=token.company.owner,
            **fields,
        )
        request.approve(reviewer, notes=notes)
    finally:
        restore_every_migration()
    request.refresh_from_db()
    return request


def retained_instruction(*, actor, **payload):
    from shared.db import atomic
    from shared.tests.schema import migrate_to, restore_every_migration
    from tokens.models import RegisterInstruction, ShareToken
    from tokens.services.register_instructions import _items
    from tokens.services.register_openings import _authority_values, _retain

    try:
        historical = migrate_to([("tokens", "0099_company_register_deployment_guards")])
        values = _authority_values(
            "director_resolution", payload["approving_director"], payload["authority_reference"], payload["reason"]
        )
        del values["authority"]
        proposal = historical.get_model("tokens", "RegisterInstruction")(
            uuid=payload["operation_id"],
            company_id=ShareToken.objects.get(pk=payload["token_id"]).company_id,
            token_id=payload["token_id"],
            kind=payload["kind"],
            items=_items(payload["kind"], payload["items"]),
            **values,
        )
        original_actor = historical.get_model("authentication", "CustomUser").objects.get(pk=actor.pk)
        with atomic(), patch(
            "tokens.services.register_openings.CompanyDocument", historical.get_model("companies", "CompanyDocument")
        ):
            _retain(proposal, payload["document_id"], original_actor)
    finally:
        restore_every_migration()
    return RegisterInstruction.objects.get(pk=proposal.pk)


def retained_paid_instruction(*, actor, reviewer=None, status="submitted", **payload):
    from shared.db import atomic, use_migrate, use_operator
    from shared.tests.schema import migrate_to, restore_every_migration
    from tokens.models import RegisterInstruction
    from tokens.services.register_instructions import _items
    from tokens.services.register_openings import _authority_values, _retain

    if payload["kind"] != "issue" or not all("subscription" in item for item in payload["items"]):
        raise AssertionError("Retained paid instruction history requires its original subscription items.")
    if status not in ("submitted", "applied"):
        raise AssertionError("Construct only original pending or applied paid instruction history.")
    with use_operator():
        if RegisterInstruction.objects.filter(paid_subscription__isnull=False).exists():
            raise AssertionError("Retain predecessor history before creating current company paid proposals.")
    reviewer = reviewer or instruction_reviewer()
    values = _authority_values(
        "director_resolution", payload["approving_director"], payload["authority_reference"], payload["reason"]
    )
    del values["authority"]
    try:
        with use_migrate():
            historical = migrate_to([("tokens", "0106_company_register_paid_issues")])
        with use_operator():
            token = historical.get_model("tokens", "ShareToken").objects.get(pk=payload["token_id"])
            owner = historical.get_model("authentication", "CustomUser").objects.get(pk=actor.pk)
            proposal = historical.get_model("tokens", "RegisterInstruction")(
                uuid=payload["operation_id"],
                company_id=token.company_id,
                token_id=token.pk,
                kind="issue",
                items=_items("issue", payload["items"]),
                **values,
            )
            with atomic(), patch(
                "tokens.services.register_openings.CompanyDocument",
                historical.get_model("companies", "CompanyDocument"),
            ):
                _retain(proposal, payload["document_id"], owner)
                if status == "applied":
                    from django.utils import timezone

                    proposal.status = status
                    proposal.reviewed_by_id = reviewer.pk
                    proposal.reviewed_at = timezone.now()
                    proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    finally:
        with use_migrate():
            restore_every_migration()
    with use_operator():
        original = RegisterInstruction.objects.get(pk=proposal.pk)
        if original.preparing_appointment_id is not None or original.paid_subscription_id is not None:
            raise AssertionError("Original paid instruction history cannot acquire current company authority.")
        return original


def retained_nonpaid_cover(token, *rows, reviewer, document):
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.utils import timezone

    from shared.db import atomic
    from tokens.services.register_instructions import _items
    from tokens.services.register_openings import _authority_values, _retain

    executor = MigrationExecutor(connection)
    predecessor = ("tokens", "0100_company_register_issue_instructions")
    if (
        predecessor not in executor.loader.applied_migrations
        or ("tokens", "0101_company_register_issue_guards") in executor.loader.applied_migrations
    ):
        raise AssertionError("Retain this nonpaid cover inside the original signed fixture's actual0100 phase.")
    if any(isinstance(row, (Subscription, SwapOrder)) for row in rows):
        raise AssertionError("This predecessor cover retains only original direct nonpaid requests.")
    historical = executor.loader.project_state([predecessor]).apps
    payload = instruction_payload(token, document, rows)
    values = _authority_values(
        "director_resolution", payload["approving_director"], payload["authority_reference"], payload["reason"]
    )
    del values["authority"]
    original_actor = historical.get_model("authentication", "CustomUser").objects.get(pk=token.company.owner_id)
    proposal = historical.get_model("tokens", "RegisterInstruction")(
        uuid=payload["operation_id"],
        company_id=token.company_id,
        token_id=token.pk,
        kind="issue",
        items=_items("issue", payload["items"]),
        **values,
    )
    with atomic(), patch(
        "tokens.services.register_openings.CompanyDocument", historical.get_model("companies", "CompanyDocument")
    ):
        _retain(proposal, document.pk, original_actor)
        proposal.status = "applied"
        proposal.reviewed_by_id = reviewer.pk
        proposal.reviewed_at = timezone.now()
        proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    return proposal
