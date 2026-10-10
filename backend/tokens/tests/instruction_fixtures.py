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
    from shared.db import use_migrate
    from shared.tests.retained_rows import retained_rows
    from tokens.models import ShareIssuanceRequest
    from tokens.tests.retained_guards import REQUEST_GUARDS

    reviewer = reviewer or instruction_reviewer()
    with use_migrate(), retained_rows(*REQUEST_GUARDS):
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
    request.refresh_from_db()
    return request


def retained_instruction(*, actor, **payload):
    from shared.db import atomic, use_migrate
    from shared.tests.retained_rows import retained_rows
    from tokens.models import RegisterInstruction, ShareToken
    from tokens.services.register_instructions import _items
    from tokens.services.register_openings import _authority_values, _retain
    from tokens.tests.retained_guards import INSTRUCTION_GUARDS

    values = _authority_values(
        "director_resolution", payload["approving_director"], payload["authority_reference"], payload["reason"]
    )
    del values["authority"]
    with use_migrate(), retained_rows(*INSTRUCTION_GUARDS):
        proposal = RegisterInstruction(
            uuid=payload["operation_id"],
            company_id=ShareToken.objects.get(pk=payload["token_id"]).company_id,
            token_id=payload["token_id"],
            kind=payload["kind"],
            items=_items(payload["kind"], payload["items"]),
            **values,
        )
        with atomic():
            _retain(proposal, payload["document_id"], actor)
    return RegisterInstruction.objects.get(pk=proposal.pk)


def retained_paid_instruction(*, actor, reviewer=None, status="submitted", **payload):
    from django.utils import timezone

    from shared.db import atomic, use_migrate, use_operator
    from shared.tests.retained_rows import retained_rows
    from tokens.models import RegisterInstruction, ShareToken
    from tokens.services.register_instructions import _items
    from tokens.services.register_openings import _authority_values, _retain
    from tokens.tests.retained_guards import INSTRUCTION_GUARDS

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
    with use_migrate(), retained_rows(*INSTRUCTION_GUARDS), use_operator():
        token = ShareToken.objects.get(pk=payload["token_id"])
        proposal = RegisterInstruction(
            uuid=payload["operation_id"],
            company_id=token.company_id,
            token_id=token.pk,
            kind="issue",
            items=_items("issue", payload["items"]),
            **values,
        )
        with atomic():
            _retain(proposal, payload["document_id"], actor)
            if status == "applied":
                proposal.status = status
                proposal.reviewed_by_id = reviewer.pk
                proposal.reviewed_at = timezone.now()
                proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    with use_operator():
        original = RegisterInstruction.objects.get(pk=proposal.pk)
        if original.preparing_appointment_id is not None or original.paid_subscription_id is not None:
            raise AssertionError("Original paid instruction history cannot acquire current company authority.")
        return original


def retained_nonpaid_cover(token, *rows, reviewer, document):
    from django.utils import timezone

    from shared.db import atomic, use_migrate
    from shared.tests.retained_rows import retained_rows
    from tokens.models import RegisterInstruction
    from tokens.services.register_instructions import _items
    from tokens.services.register_openings import _authority_values, _retain
    from tokens.tests.retained_guards import INSTRUCTION_GUARDS

    if any(isinstance(row, (Subscription, SwapOrder)) for row in rows):
        raise AssertionError("This retained cover names only original direct nonpaid requests.")
    payload = instruction_payload(token, document, rows)
    values = _authority_values(
        "director_resolution", payload["approving_director"], payload["authority_reference"], payload["reason"]
    )
    del values["authority"]
    with use_migrate(), retained_rows(*INSTRUCTION_GUARDS):
        proposal = RegisterInstruction(
            uuid=payload["operation_id"],
            company_id=token.company_id,
            token_id=token.pk,
            kind="issue",
            items=_items("issue", payload["items"]),
            **values,
        )
        with atomic():
            _retain(proposal, document.pk, token.company.owner)
            proposal.status = "applied"
            proposal.reviewed_by_id = reviewer.pk
            proposal.reviewed_at = timezone.now()
            proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    return proposal
