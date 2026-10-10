from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from blockchain.models import BlockchainTransaction
from blockchain.services import outgoing
from shared.db import use_migrate
from shared.tests.retained_rows import retained_rows
from tokens.models import ShareIssuance, ShareIssuanceExecution, ShareIssuanceRequest
from tokens.services import issuance_execution
from tokens.services.holder_identity import identity_at_allotment
from tokens.tests.retained_guards import (
    INSTRUCTION_GUARDS,
    ISSUANCE_GUARDS,
    REQUEST_GUARDS,
)


def approve_retained_request(request, reviewer, *, notes=""):
    from shared.db import use_operator

    with use_migrate(), retained_rows(*REQUEST_GUARDS):
        with use_operator():
            request.approve(reviewer, notes=notes)
    return request


def retain_signed_issuance(
    *,
    token,
    actor,
    recipient,
    amount,
    client,
    recipient_name="",
    reason="Retained issue",
    instructed=None,
    reviewed_by=None,
):
    with use_migrate(), retained_rows(*(ISSUANCE_GUARDS + INSTRUCTION_GUARDS)):
        with use_migrate():
            request = ShareIssuanceRequest.objects.create(
                token=token, recipient_address=recipient, recipient_name=recipient_name, amount=amount, reason=reason
            )
            request.approve(reviewed_by or actor)
            if instructed is not None:
                instructed(request)
                request.refresh_from_db()
            intent = issuance_execution._intent(request, token)
            command = ShareIssuanceExecution.objects.create(
                uuid=request.dispatch_id,
                request_id=request.pk,
                token_id=token.pk,
                company_id=token.company_id,
                executed_by_id=actor.pk,
                authority=issuance_execution.REQUEST_AUTHORITY,
                intent=intent,
            )
            stamped = identity_at_allotment(intent["recipient"], chain=intent["token_chain"])
            issuance = ShareIssuance.objects.create(
                token=token,
                recipient_address=intent["recipient"],
                recipient_name=stamped.name or recipient_name,
                recipient_residential_address=stamped.residential_address,
                identity_stamped_at=timezone.now() if stamped.name else None,
                amount=intent["amount"],
                issuance_type=request.issuance_type,
                reason=f"Issuance request: {request.reason}",
                initiated_by=actor,
                idempotency_key=f"issuance-request:{request.pk}",
            )
            command.issuance_id, command.status = issuance.pk, "executing"
            command.save(update_fields=["issuance_id", "status", "updated_at"])
            request.mark_executing()
            fields = {name: intent[name] for name in issuance_execution.INTENT_FIELDS}
            fields["value"] = int(fields["value"])
            claim = outgoing.open_operation(f"share-issuance:{request.pk}:{command.pk}", **fields)
            command.operation_id = claim.operation_id
            command.save(update_fields=["operation", "updated_at"])
            prepared = outgoing.prepare_operation(claim, client)

            def retain(attempt):
                record = BlockchainTransaction.objects.create(
                    tx_hash=attempt.tx_hash,
                    tx_type="token_mint",
                    status="submitted",
                    from_address=intent["sender"],
                    to_address=intent["to"],
                    function_name="mint",
                    function_args={"recipient": intent["recipient"], "amount": intent["amount"]},
                    related_model="tokens.ShareIssuanceRequest",
                    related_uuid=request.pk,
                    submitted_at=attempt.created_at,
                )
                command.transaction_id = record.pk
                command.save(update_fields=["transaction", "updated_at"])
                issuance.transaction, issuance.tx_hash = record, record.tx_hash
                issuance.status, issuance.processed_at = "processing", attempt.created_at
                issuance.save(update_fields=["transaction", "tx_hash", "status", "processed_at", "updated_at"])

            outgoing.sign_operation(claim, prepared, settings.BLOCKCHAIN_OPERATOR_KEY, on_signed=retain)
    return request, command.pk


def install_retained_issuance(test):
    from blockchain.tests.outgoing_fixtures import admitted_signer
    from shared.tests.tenants import make_tenant
    from tokens.tests.issuance_fixtures import IssuanceNode

    test.tenant = make_tenant("retained-issuance-" + uuid4().hex)
    test.actor = get_user_model().objects.create_superuser(
        email=f"retained-{uuid4().hex}@example.test", password="synthetic"
    )
    test.token = test.tenant.deployed_token
    admitted_signer()
    test.node = IssuanceNode()
    test.enterContext(patch("tokens.services.issuance_execution.get_base_chain_client", return_value=test.node.client))
    test.enterContext(patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=True))


def prepare_retained_execution(request, actor, client):
    from shared.db import use_operator
    from tokens.exceptions import IssuanceRefusedException
    from tokens.models import ShareIssuanceExecution

    with use_migrate(), retained_rows(*(ISSUANCE_GUARDS + INSTRUCTION_GUARDS)):
        with use_operator():
            execution = ShareIssuanceExecution.objects.filter(request_id=request.pk).first()
            if execution is None:
                row = ShareIssuanceExecution.objects.create(
                    uuid=request.dispatch_id,
                    request_id=request.pk,
                    token_id=request.token_id,
                    company_id=request.company_id,
                    executed_by_id=actor.pk,
                    authority=issuance_execution.REQUEST_AUTHORITY,
                    intent=issuance_execution._intent(request, request.token),
                )
                execution = ShareIssuanceExecution.objects.get(pk=row.pk)
            elif execution.status == "failed":
                execution = issuance_execution.admit(
                    request, actor, confirmed=issuance_execution.confirmation(request, actor)
                )
            if execution.status == "queued":
                execution = issuance_execution._start(execution)
            if execution.status == "executing":
                claim = issuance_execution._claim(execution)
                operation = outgoing.OutgoingOperation.objects.get(pk=claim.operation_id)
                if operation.status == "preparing":
                    try:
                        issuance_execution._preflight(execution, client)
                        prepared = outgoing.prepare_operation(claim, client)
                        outgoing.sign_operation(
                            claim,
                            prepared,
                            settings.BLOCKCHAIN_OPERATOR_KEY,
                            on_signed=lambda attempt: issuance_execution._record_signed(execution.pk, attempt),
                        )
                    except IssuanceRefusedException as exception:
                        outgoing.fail_preparing(claim)
                        issuance_execution._project(execution, claim, refusal=str(exception.detail))
    return execution.pk
