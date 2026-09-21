import logging
from collections.abc import Mapping
from typing import NamedTuple
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import connections
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from rest_framework.exceptions import PermissionDenied
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    OutgoingStatus,
    TransactionStatus,
    TransactionType,
)
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from integrations.blockchain.receipts import (
    nonnegative_integer,
    normalized_hash,
    transaction_hash_matches,
)
from offerings.models import Subscription, SubscriptionStatus
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.constants import ISSUANCE_RECOVERY_COLLISION_RETRIES
from tokens.exceptions import (
    IssuanceExecutionAdvanced,
    IssuanceExecutionConflict,
    IssuanceExecutionUnresolved,
    IssuanceRefusedException,
)
from tokens.models import (
    IssuanceExecutionStatus,
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.holder_identity import identity_at_allotment
from wallets.models import ChainObservationFinality, ChainObservationResult
from wallets.services.chain_evidence import collect_chain_evidence
from wallets.services.chain_observations import finality_policy
from wallets.services.receipt_readers import MAX_BLOCK_NUMBER

logger = logging.getLogger(__name__)
INTENT_FIELDS = ("chain_id", "sender", "to", "value", "data")
CONFIRMATION_SALT = "tokens.share_issuance.execute"
ATTRIBUTION_REQUIRED = "This issuance requires operator attribution; its original history is retained."
REQUEST_AUTHORITY = "tokens.change_shareissuancerequest"
SUBSCRIPTION_AUTHORITY = "offerings.change_subscription"
TERMINAL = (IssuanceExecutionStatus.EXECUTED, IssuanceExecutionStatus.FAILED, IssuanceExecutionStatus.CANCELLED)


class FinalizedIssuanceReceipt(NamedTuple):
    claim_id: UUID
    attempt_id: UUID
    policy: dict
    receipt: Mapping


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Issuance execution requires operator authority.")


def _boundary():
    _operator()
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise IssuanceExecutionConflict("Issuance execution requires autocommit outside every transaction block.")


def _authorize(user, authority):
    actor = get_user_model().objects.filter(pk=getattr(user, "pk", None)).first()
    if actor is None or not actor.is_active or not actor.is_staff or not actor.has_perm(authority):
        raise PermissionDenied("You cannot execute this issuance.")
    return actor


def authorize_allotment(user):
    _boundary()
    return _authorize(user, SUBSCRIPTION_AUTHORITY)


def confirmation(request, user, *, subscription=None):
    _boundary()
    authority = SUBSCRIPTION_AUTHORITY if subscription else REQUEST_AUTHORITY
    actor = _authorize(user, authority)
    current = ShareIssuanceRequest.objects.get(pk=request.pk)
    if current.dispatch_id is None:
        raise IssuanceExecutionConflict(ATTRIBUTION_REQUIRED)
    execution = ShareIssuanceExecution.objects.select_related("operation").filter(request_id=current.pk).first()
    claim = (
        execution.operation.claim_id
        if execution and execution.status == IssuanceExecutionStatus.FAILED and execution.operation_id
        else None
    )
    return signing.dumps(
        {
            "request": str(current.pk),
            "dispatch": str(current.dispatch_id),
            "actor": actor.pk,
            "authority": authority,
            "subscription": str(subscription.pk) if subscription else None,
            "claim": str(claim) if claim else None,
        },
        salt=CONFIRMATION_SALT,
    )


def _confirmed(request, actor, authority, subscription, value):
    try:
        confirmed = signing.loads(value, salt=CONFIRMATION_SALT)
        if any(
            confirmed.get(key) != expected
            for key, expected in {
                "request": str(request.pk),
                "dispatch": str(request.dispatch_id),
                "actor": actor.pk,
                "authority": authority,
                "subscription": str(subscription.pk) if subscription else None,
            }.items()
        ):
            raise ValueError
        return UUID(confirmed["claim"]) if confirmed.get("claim") else None
    except (signing.BadSignature, TypeError, ValueError, AttributeError):
        raise IssuanceExecutionConflict("Reload the issuance execution confirmation.") from None


def _intent(request, token):
    if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED) or token.chain != "base":
        raise IssuanceExecutionConflict("The original token must be deployed on Base.")
    try:
        if request.amount <= 0 or token.decimals != 0 or request.company_id != token.company_id:
            raise ValueError
        recipient = Web3.to_checksum_address(request.recipient_address)
        data = Web3.keccak(text="mint(address,uint256)")[:4] + encode(
            ["address", "uint256"], [recipient, request.amount]
        )
        intent = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            sender=Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address,
            to=token.contract_address,
            data=data,
        )
    except (ValueError, TypeError, AttributeError):
        raise IssuanceExecutionConflict("The issuance terms, token or signing identity are invalid.") from None
    return intent | {"token_chain": token.chain, "recipient": recipient.lower(), "amount": str(request.amount)}


def _lock(execution_id, operation_id=None):
    operation = OutgoingOperation.objects.select_for_update().get(pk=operation_id) if operation_id else None
    observed = ShareIssuanceExecution.objects.get(pk=execution_id)
    token = ShareToken.objects.select_for_update().get(pk=observed.token_id)
    subscription = (
        Subscription.objects.select_for_update().get(pk=observed.subscription_id) if observed.subscription_id else None
    )
    request = ShareIssuanceRequest.objects.select_for_update().get(pk=observed.request_id)
    execution = ShareIssuanceExecution.objects.select_for_update().get(pk=execution_id)
    if execution.operation_id != operation_id:
        raise IssuanceExecutionAdvanced()
    if (
        request.dispatch_id != execution.pk
        or request.token_id != token.pk
        or request.company_id != execution.company_id
        or (subscription and subscription.issuance_request_id != request.pk)
    ):
        raise IssuanceExecutionConflict(ATTRIBUTION_REQUIRED)
    return execution, request, token, subscription, operation


def _enqueue(execution):
    if execution.subscription_id:
        from offerings.tasks import allot_subscription_task

        allot_subscription_task.defer(
            subscription_uuid=str(execution.subscription_id),
            executed_by=execution.executed_by_id,
            execution_id=str(execution.pk),
        )
    else:
        from tokens.tasks import execute_review_request_task

        execute_review_request_task.defer(
            model_label="tokens.ShareIssuanceRequest",
            request_uuid=str(execution.request_id),
            executed_by=execution.executed_by_id,
            execution_id=str(execution.pk),
        )


def _new(request, token, actor, authority, subscription=None):
    if request.dispatch_id is None or request.status != RequestStatus.APPROVED:
        raise IssuanceExecutionConflict("Only a newly approved issuance can be admitted.")
    if ShareIssuance.objects.filter(idempotency_key=f"issuance-request:{request.pk}").exists():
        raise IssuanceExecutionConflict(ATTRIBUTION_REQUIRED)
    if BlockchainTransaction.objects.filter(
        related_model="tokens.ShareIssuanceRequest", related_uuid=request.pk
    ).exists():
        raise IssuanceExecutionConflict(ATTRIBUTION_REQUIRED)
    execution = ShareIssuanceExecution.objects.create(
        pk=request.dispatch_id,
        request_id=request.pk,
        token_id=token.pk,
        company_id=token.company_id,
        subscription_id=subscription.pk if subscription else None,
        executed_by_id=actor.pk,
        authority=authority,
        intent=_intent(request, token),
    )
    _enqueue(execution)
    return execution


def admit_allotment(request, subscription, user):
    _operator()
    actor = _authorize(user, SUBSCRIPTION_AUTHORITY)
    if not connections[current_alias()].in_atomic_block:
        raise IssuanceExecutionConflict("Allotment admission must commit with its subscription and job.")
    token = ShareToken.objects.select_for_update().get(pk=request.token_id)
    return _new(request, token, actor, SUBSCRIPTION_AUTHORITY, subscription)


def admit(request, user, *, confirmed, subscription=None):
    _boundary()
    authority = SUBSCRIPTION_AUTHORITY if subscription else REQUEST_AUTHORITY
    actor = _authorize(user, authority)
    retry_of = _confirmed(request, actor, authority, subscription, confirmed)
    previous = ShareIssuanceExecution.objects.filter(request_id=request.pk).first()
    with atomic(durable=True):
        if previous:
            execution, current, token, linked, operation = _lock(previous.pk, previous.operation_id)
            if execution.subscription_id != (subscription.pk if subscription else None):
                raise IssuanceExecutionConflict("Recover this issuance through its original subscription.")
            if execution.status == IssuanceExecutionStatus.CANCELLED:
                return execution
            if retry_of is None or execution.retry_of == retry_of or execution.status != IssuanceExecutionStatus.FAILED:
                if execution.status not in TERMINAL:
                    _enqueue(execution)
                return execution
            if (
                operation is None
                or operation.claim_id != retry_of
                or operation.status not in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)
            ):
                raise IssuanceExecutionConflict("This confirmation no longer identifies the failed issuance attempt.")
            if current.status != RequestStatus.FAILED or (linked and linked.status != SubscriptionStatus.PAID):
                raise IssuanceExecutionConflict("Only the original failed, unrefunded issuance can be retried.")
            if _intent(current, token) != execution.intent:
                raise IssuanceExecutionConflict("The original issuance configuration has changed.")
            execution.retry_of = retry_of
            execution.status = IssuanceExecutionStatus.QUEUED
            execution.save(update_fields=["retry_of", "status", "updated_at"])
            current.status = RequestStatus.APPROVED
            current.save(update_fields=["status", "updated_at"])
            _enqueue(execution)
            return execution
        if subscription is not None or retry_of is not None:
            raise IssuanceExecutionConflict("This issuance has no original admission to retry.")
        token = ShareToken.objects.select_for_update().get(pk=request.token_id)
        current = ShareIssuanceRequest.objects.select_for_update().get(pk=request.pk)
        existing = ShareIssuanceExecution.objects.filter(request_id=current.pk).first()
        if existing:
            return existing
        if Subscription.objects.filter(issuance_request=current).exists():
            raise IssuanceExecutionConflict("Admit this issuance through its subscription.")
        return _new(current, token, actor, authority)


def cancel_queued(request, subscription):
    _operator()
    current = ShareIssuanceRequest.objects.select_for_update().get(pk=request.pk)
    execution = ShareIssuanceExecution.objects.select_for_update().filter(request_id=current.pk).first()
    if execution is None:
        return False
    if execution.subscription_id != subscription.pk or execution.status not in (
        IssuanceExecutionStatus.QUEUED,
        IssuanceExecutionStatus.FAILED,
        IssuanceExecutionStatus.CANCELLED,
    ):
        raise IssuanceExecutionConflict("The issuance has started. Resolve its original transaction before refunding.")
    if execution.status != IssuanceExecutionStatus.CANCELLED:
        execution.status = IssuanceExecutionStatus.CANCELLED
        execution.save(update_fields=["status", "updated_at"])
        current.status = RequestStatus.REJECTED
        current.rejection_reason = f"Cancelled by refund of subscription {subscription.reference or subscription.pk}."
        current.save(update_fields=["status", "rejection_reason", "updated_at"])
    return True


def _preflight(execution, client):
    from tokens.services import share_token_service

    if client.assert_expected_chain() != execution.intent["chain_id"]:
        raise IssuanceExecutionUnresolved("The provider is on a different chain from the admitted issuance.")
    token = ShareToken.objects.get(pk=execution.token_id)
    contract = client.load_contract("ShareToken", execution.intent["to"])
    if token.status == ShareTokenStatus.PAUSED or contract.functions.paused().call():
        raise IssuanceRefusedException(share_token_service.TOKEN_PAUSED)
    if not share_token_service.is_recipient_whitelisted(execution.intent["recipient"]):
        raise IssuanceRefusedException(share_token_service.NOT_WHITELISTED)
    authorized = contract.functions.authorizedShares().call()
    issued = contract.functions.totalSupply().call()
    if type(authorized) is not int or type(issued) is not int or min(authorized, issued) < 0:
        raise IssuanceExecutionUnresolved("The provider did not return valid share totals.")
    if int(execution.intent["amount"]) > authorized - issued:
        raise IssuanceRefusedException(share_token_service.EXCEEDS_AUTHORIZED)


def _start(execution):
    stamped = identity_at_allotment(execution.intent["recipient"], chain=execution.intent["token_chain"])
    with atomic(durable=True):
        current, request, token, subscription, _ = _lock(execution.pk, execution.operation_id)
        if current.status != IssuanceExecutionStatus.QUEUED:
            return current
        if request.status != RequestStatus.APPROVED or (
            subscription and subscription.status != SubscriptionStatus.PAID
        ):
            raise IssuanceExecutionConflict("The original issuance no longer owns its approved allocation.")
        if _intent(request, token) != current.intent:
            raise IssuanceExecutionConflict("The original issuance configuration has changed.")
        if current.issuance_id is None:
            actor = get_user_model().objects.filter(pk=current.executed_by_id).first()
            issuance = ShareIssuance.objects.create(
                token=token,
                recipient_address=current.intent["recipient"],
                recipient_name=stamped.name or request.recipient_name,
                recipient_residential_address=stamped.residential_address,
                identity_stamped_at=timezone.now() if stamped.name else None,
                amount=current.intent["amount"],
                issuance_type=request.issuance_type,
                reason=f"Issuance request: {request.reason}",
                initiated_by=actor,
                idempotency_key=f"issuance-request:{request.pk}",
            )
            current.issuance_id = issuance.pk
        current.status = IssuanceExecutionStatus.EXECUTING
        current.save(update_fields=["status", "issuance_id", "updated_at"])
        request.mark_executing()
        return current


def _claim(execution):
    if execution.operation_id:
        operation = OutgoingOperation.objects.get(pk=execution.operation_id)
        if (
            operation.status not in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)
            or execution.retry_of != operation.claim_id
        ):
            return outgoing.OperationClaim(operation.pk, operation.claim_id)
    intent = {field: execution.intent[field] for field in INTENT_FIELDS}
    intent["value"] = int(intent["value"])
    claim = outgoing.open_operation(
        f"share-issuance:{execution.request_id}:{execution.pk}", **intent, restart_of=execution.retry_of or UUID(int=0)
    )
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        current, request, _, _, _ = _lock(execution.pk, execution.operation_id)
        if current.status in TERMINAL and current.operation_id == operation.pk:
            return outgoing.OperationClaim(operation.pk, operation.claim_id)
        if current.status != IssuanceExecutionStatus.EXECUTING or request.status != RequestStatus.EXECUTING:
            raise IssuanceExecutionConflict("The original issuance no longer owns execution.")
        current.operation = operation
        current.save(update_fields=["operation", "updated_at"])
    return outgoing.OperationClaim(operation.pk, operation.claim_id)


def _record_signed(execution_id, attempt):
    execution, request, token, _, operation = _lock(execution_id, attempt.operation_id)
    if (
        execution.status != IssuanceExecutionStatus.EXECUTING
        or request.status != RequestStatus.EXECUTING
        or operation.claim_id != attempt.claim_id
        or _intent(request, token) != execution.intent
    ):
        raise IssuanceExecutionConflict("The admitted issuance changed before signing.")
    intent = execution.intent
    record = BlockchainTransaction.objects.create(
        tx_hash=attempt.tx_hash,
        tx_type=TransactionType.TOKEN_MINT,
        status=TransactionStatus.SUBMITTED,
        from_address=intent["sender"],
        to_address=intent["to"],
        function_name="mint",
        function_args={"recipient": intent["recipient"], "amount": intent["amount"]},
        related_model="tokens.ShareIssuanceRequest",
        related_uuid=execution.request_id,
        submitted_at=attempt.created_at,
    )
    execution.transaction = record
    execution.save(update_fields=["transaction", "updated_at"])
    issuance = ShareIssuance.objects.select_for_update().get(pk=execution.issuance_id)
    issuance.transaction = record
    issuance.tx_hash = record.tx_hash
    issuance.status = IssuanceStatus.PROCESSING
    issuance.processed_at = attempt.created_at
    issuance.error_message = ""
    issuance.save(update_fields=["transaction", "tx_hash", "status", "processed_at", "error_message", "updated_at"])


def _retain_receipt(execution, operation, receipt=None):
    if operation.status not in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
        return
    record = execution.transaction
    if record is None or record.tx_hash != operation.current_attempt.tx_hash:
        raise IssuanceExecutionConflict("The issuance is missing its original signed transaction association.")
    record.status = (
        TransactionStatus.CONFIRMED if operation.status == OutgoingStatus.CONFIRMED else TransactionStatus.REVERTED
    )
    record.block_number = receipt["blockNumber"] if receipt is not None else operation.block_number
    record.block_hash = "0x" + normalized_hash(receipt["blockHash"]) if receipt is not None else operation.block_hash
    record.gas_used = receipt["gasUsed"] if receipt is not None else operation.gas_used
    record.confirmed_at = record.confirmed_at or timezone.now()
    record.save(update_fields=["status", "block_number", "block_hash", "gas_used", "confirmed_at", "updated_at"])


def _finalized_receipt(execution, operation, client):
    if client.assert_expected_chain() != execution.intent["chain_id"]:
        raise IssuanceExecutionUnresolved()
    network = f"evm:{execution.intent['chain_id']}"
    policy = finality_policy(network, BLOCKCHAIN_BASE)
    if policy["mode"] not in ("finalized", "depth"):
        logger.warning("Issuance execution %s awaits an approved finality policy", execution.pk)
        return None
    tx_hash = operation.current_attempt.tx_hash
    verdict = collect_chain_evidence(
        client,
        chain=BLOCKCHAIN_BASE,
        network=network,
        tx_hash=tx_hash,
        previous_block={"hash": operation.block_hash, "height": operation.block_number},
        policy=policy,
    )
    if (
        verdict["result"] != ChainObservationResult.INCLUDED
        or verdict["finality"] != ChainObservationFinality.SATISFIED
    ):
        logger.info("Issuance execution %s awaits finality: %s", execution.pk, verdict["reason"])
        return None
    included = verdict["evidence"]["receipt"]
    if included["succeeded"] is not (operation.status == OutgoingStatus.CONFIRMED):
        logger.warning("Issuance execution %s has a changed receipt outcome; attribution is required", execution.pk)
        return None
    receipt = client.get_transaction_receipt(tx_hash)
    if not isinstance(receipt, Mapping) or (
        type(receipt.get("status")) is not int
        or receipt["status"] != int(included["succeeded"])
        or not transaction_hash_matches(receipt.get("transactionHash"), tx_hash)
        or nonnegative_integer(receipt.get("blockNumber"), maximum=MAX_BLOCK_NUMBER) != included["height"]
        or not transaction_hash_matches(receipt.get("blockHash"), included["hash"])
        or nonnegative_integer(receipt.get("gasUsed"), maximum=MAX_BLOCK_NUMBER) is None
        or str(receipt.get("to", "")).lower() != execution.intent["to"]
        or str(receipt.get("from", "")).lower() != execution.intent["sender"]
        or client.assert_expected_chain() != execution.intent["chain_id"]
    ):
        raise IssuanceExecutionUnresolved("The receipt does not identify the original issuance's finalized inclusion.")
    if included["succeeded"]:
        _verify_mint(execution, client, receipt)
    return FinalizedIssuanceReceipt(operation.claim_id, operation.current_attempt_id, policy, dict(receipt))


def _verify_mint(execution, client, receipt):
    contract = client.load_contract("ShareToken", execution.intent["to"])
    events = contract.events.Transfer().process_receipt(receipt, errors=DISCARD)
    matches = [
        event
        for event in events
        if event["address"].lower() == execution.intent["to"]
        and int(event["args"]["from"], 16) == 0
        and event["args"]["to"].lower() == execution.intent["recipient"]
        and int(event["args"]["value"]) == int(execution.intent["amount"])
    ]
    if len(matches) != 1:
        raise IssuanceExecutionUnresolved("The receipt has no unique mint event matching the approved issuance.")


def _project(execution, claim, *, finalized=None, refusal=None):
    with atomic(durable=True):
        current, request, _, subscription, operation = _lock(execution.pk, claim.operation_id)
        if operation.claim_id != claim.claim_id:
            return current
        if current.status in TERMINAL or current.retry_of == operation.claim_id:
            return current
        if operation.status in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
            if finalized is None:
                return current
            if (
                finalized.claim_id != operation.claim_id
                or finalized.attempt_id != operation.current_attempt_id
                or finalized.policy != finality_policy(f"evm:{current.intent['chain_id']}", BLOCKCHAIN_BASE)
                or not transaction_hash_matches(finalized.receipt["transactionHash"], operation.current_attempt.tx_hash)
                or finalized.receipt["status"] != int(operation.status == OutgoingStatus.CONFIRMED)
            ):
                raise IssuanceExecutionUnresolved("The issuance identity or finality policy changed before completion.")
            _retain_receipt(current, operation, finalized.receipt)
            current.status = (
                IssuanceExecutionStatus.EXECUTED
                if operation.status == OutgoingStatus.CONFIRMED
                else IssuanceExecutionStatus.FAILED
            )
            if current.status == IssuanceExecutionStatus.EXECUTED:
                current.finalized_receipt = {
                    "block_number": current.transaction.block_number,
                    "block_hash": current.transaction.block_hash,
                    "gas_used": current.transaction.gas_used,
                    "policy": finalized.policy,
                }
        elif operation.status == OutgoingStatus.FAILED:
            current.status = IssuanceExecutionStatus.FAILED
        else:
            return current
        current.save(update_fields=["status", "finalized_receipt", "updated_at"])
        issuance = ShareIssuance.objects.select_for_update().get(pk=current.issuance_id)
        if current.status == IssuanceExecutionStatus.EXECUTED:
            issuance.mark_completed(
                tx_hash=current.transaction.tx_hash,
                block_number=current.transaction.block_number,
                gas_used=current.transaction.gas_used,
                transaction=current.transaction,
            )
            request.mark_executed(issuance)
            if subscription:
                subscription.mark_allotted()
        else:
            reason = (
                "The original issuance transaction reverted."
                if operation.status == OutgoingStatus.REVERTED
                else refusal or "Issuance preparation failed before a transaction was signed."
            )
            issuance.mark_failed(reason)
            request.mark_failed(reason)
        return current


def _result(execution):
    execution = ShareIssuanceExecution.objects.select_related("transaction").get(pk=execution.pk)
    status = {
        IssuanceExecutionStatus.QUEUED: RequestStatus.APPROVED,
        IssuanceExecutionStatus.CANCELLED: RequestStatus.REJECTED,
    }.get(execution.status, execution.status)
    record = execution.transaction
    return {
        "status": status,
        "tx_hash": record.tx_hash if record else None,
        "block_number": record.block_number if record else None,
        "gas_used": record.gas_used if record else None,
    }


def _recover(execution_id):
    execution = ShareIssuanceExecution.objects.get(pk=execution_id)
    if execution.status in TERMINAL:
        return _result(execution)
    client = get_base_chain_client()
    if execution.status == IssuanceExecutionStatus.QUEUED:
        try:
            _preflight(execution, client)
        except IssuanceRefusedException:
            pass
        execution = _start(execution)
        if execution.status in TERMINAL:
            return _result(execution)
    claim = _claim(execution)
    execution.refresh_from_db()
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if execution.status in TERMINAL:
        return _result(execution)
    refusal = None
    if operation.status == OutgoingStatus.PREPARING:
        try:
            _preflight(execution, client)
            prepared = outgoing.prepare_operation(claim, client)
            outgoing.sign_operation(
                claim,
                prepared,
                settings.BLOCKCHAIN_OPERATOR_KEY,
                on_signed=lambda attempt: _record_signed(execution.pk, attempt),
            )
        except IssuanceRefusedException as exc:
            refusal = str(exc.detail)
            outgoing.fail_preparing(claim)
        except Exception:
            logger.warning("Issuance execution %s requires committed-state recovery", execution.pk)
            outgoing.fail_preparing(claim)
    operation.refresh_from_db()
    execution.refresh_from_db()
    if operation.claim_id != claim.claim_id:
        return _result(execution)
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
        if operation.status == OutgoingStatus.SIGNED:
            outgoing.broadcast_operation(claim, client)
            outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
    finalized = None
    if operation.status in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
        with atomic(durable=True):
            current, _, _, _, locked = _lock(execution.pk, claim.operation_id)
            if locked.claim_id != claim.claim_id or current.status in TERMINAL or current.retry_of == locked.claim_id:
                return _result(current)
            _retain_receipt(current, locked)
        finalized = _finalized_receipt(execution, operation, client)
    return _result(_project(execution, claim, finalized=finalized, refusal=refusal))


def recover(execution_id):
    from tokens.services.share_token_service import seed_recipient_holding

    _boundary()
    for attempt in range(ISSUANCE_RECOVERY_COLLISION_RETRIES):
        try:
            result = _recover(execution_id)
            break
        except IssuanceExecutionAdvanced:
            if attempt == ISSUANCE_RECOVERY_COLLISION_RETRIES - 1:
                raise
    if result["status"] == RequestStatus.EXECUTED:
        execution = ShareIssuanceExecution.objects.get(pk=execution_id)
        seed_recipient_holding(execution.intent["to"], execution.intent["recipient"])
    return result
