from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission

from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import attach_file, make_document
from offerings.models import Subscription
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)

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


def instruction_item(row):
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
        "kind": "issue",
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
