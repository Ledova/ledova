import logging
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import connections
from django.db.models import OuterRef, Q, Subquery
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from hexbytes import HexBytes
from rest_framework.exceptions import PermissionDenied
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    OutgoingStatus,
    SignedAttempt,
    TransactionStatus,
    TransactionType,
)
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.exceptions import CapitalIncreaseConflict, CapitalIncreaseUnresolved
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RequestStatus,
    ShareToken,
    ShareTokenStatus,
)

logger = logging.getLogger(__name__)
INTENT_FIELDS = ("chain_id", "sender", "to", "value", "data")
CONFIRMATION_SALT = "tokens.capital_increase.execute"
ATTRIBUTION_REQUIRED = "This capital increase requires operator attribution; its original history is retained."


def _boundary():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Capital execution requires operator authority.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise CapitalIncreaseConflict("Capital execution requires autocommit outside every transaction block.")


def _authorize(user):
    actor = get_user_model().objects.filter(pk=getattr(user, "pk", None)).first()
    if (
        actor is None
        or not actor.is_active
        or not actor.is_staff
        or not actor.has_perm("tokens.change_capitalincreaserequest")
    ):
        raise PermissionDenied("You cannot execute this capital increase.")
    return actor


def confirmation(request, user):
    _boundary()
    actor = _authorize(user)
    current = CapitalIncreaseRequest.objects.get(pk=request.pk)
    if current.dispatch_id is None:
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
    execution = CapitalIncreaseExecution.objects.select_related("operation").filter(request_id=current.pk).first()
    if execution and execution.attribution_evidence is not None:
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
    failed_claim = (
        execution.operation.claim_id
        if execution
        and execution.operation_id
        and execution.projected_at is not None
        and current.status == RequestStatus.FAILED
        and execution.operation.status in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)
        else None
    )
    return signing.dumps(
        {
            "request": str(current.pk),
            "dispatch": str(current.dispatch_id),
            "actor": actor.pk,
            "claim": str(failed_claim) if failed_claim else None,
        },
        salt=CONFIRMATION_SALT,
    )


def _confirmed(request, actor, value):
    try:
        confirmed = signing.loads(value, salt=CONFIRMATION_SALT)
    except (signing.BadSignature, TypeError):
        raise CapitalIncreaseConflict("Reload the capital execution confirmation.") from None
    if (
        confirmed.get("request") != str(request.pk)
        or confirmed.get("dispatch") != str(request.dispatch_id)
        or confirmed.get("actor") != actor.pk
    ):
        raise CapitalIncreaseConflict("The confirmation identifies a different request or operator.")
    return UUID(confirmed["claim"]) if confirmed.get("claim") else None


def _intent(request, token):
    if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED) or token.chain != "base":
        raise CapitalIncreaseConflict("The original token must be deployed on Base.")
    try:
        prior = int(token.total_supply)
        target = int(request.new_authorized_total)
        if prior < 0 or target <= 0 or request.additional_shares <= 0 or token.decimals != 0:
            raise ValueError
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        data = Web3.keccak(text="setAuthorizedShares(uint256)")[:4] + encode(["uint256"], [target])
        intent = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID, sender=sender, to=token.contract_address, data=data
        )
    except (ValueError, TypeError, AttributeError):
        raise CapitalIncreaseConflict("The capital terms, token or signing identity are invalid.") from None
    return intent | {
        "token_chain": token.chain,
        "prior_authorized_total": str(prior),
        "new_authorized_total": str(target),
        "additional_shares": str(request.additional_shares),
    }


def _lock(execution_id, operation_id=None):
    operation = OutgoingOperation.objects.select_for_update().get(pk=operation_id) if operation_id else None
    observed = CapitalIncreaseExecution.objects.get(pk=execution_id)
    token = ShareToken.objects.select_for_update().get(pk=observed.token_id)
    request = CapitalIncreaseRequest.objects.select_for_update().get(pk=observed.request_id)
    execution = CapitalIncreaseExecution.objects.select_for_update().get(pk=execution_id)
    if execution.operation_id != operation_id:
        raise CapitalIncreaseConflict("Another worker advanced this capital execution. Recover the current attempt.")
    if (
        request.dispatch_id != execution.pk
        or request.token_id != token.pk
        or request.company_id != execution.company_id
    ):
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
    return execution, request, token, operation


def _competing_history(request, token):
    other = CapitalIncreaseRequest.objects.filter(token=token).exclude(pk=request.pk)
    if other.in_flight().exists():
        raise CapitalIncreaseConflict(f"{token.symbol} has another capital increase in flight. Wait for it to resolve.")
    recorded = CapitalIncreaseExecution.objects.filter(token_id=token.pk)
    unrecorded = other.exclude(pk__in=Subquery(recorded.values("request_id")))
    if unrecorded.exclude(status__in=(RequestStatus.DRAFT, RequestStatus.REJECTED)).exists():
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
    attributable = SignedAttempt.objects.filter(
        operation_id__in=Subquery(recorded.values("operation_id")),
        operation__intent__to=(token.contract_address or "").lower(),
        operation__intent__chain_id=settings.BLOCKCHAIN_CHAIN_ID,
    ).values("tx_hash")
    unexplained = BlockchainTransaction.objects.filter(
        Q(related_model=request._meta.label, related_uuid__in=Subquery(unrecorded.values("uuid")))
        | Q(related_model=request._meta.label, related_uuid=request.pk)
        | Q(function_name="setAuthorizedShares", to_address__iexact=token.contract_address)
    ).exclude(tx_hash__in=Subquery(attributable))
    if unexplained.exists():
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)


def admit(request, user, *, confirmed):
    from tokens.tasks import execute_review_request_task

    _boundary()
    actor = _authorize(user)
    retry_of = _confirmed(request, actor, confirmed)
    previous = CapitalIncreaseExecution.objects.filter(request_id=request.pk).first()
    with atomic(durable=True):
        if previous is not None:
            execution, current, token, operation = _lock(previous.pk, previous.operation_id)
            if execution.attribution_evidence is not None:
                raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
            if retry_of is None or execution.retry_of == retry_of or execution.projected_at is None:
                return execution
            if operation is None or operation.claim_id != retry_of:
                raise CapitalIncreaseConflict("This confirmation no longer identifies the failed capital attempt.")
            if operation.status not in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
                return execution
            if current.status != RequestStatus.FAILED:
                raise CapitalIncreaseConflict("Only the recorded failed capital attempt can be retried.")
            _competing_history(current, token)
            if int(token.total_supply) != int(execution.intent["prior_authorized_total"]):
                if current.new_authorized_total <= int(token.total_supply):
                    current.mark_superseded(
                        "A later capital increase overtook these approved terms. Submit a new request."
                    )
                    return execution
                raise CapitalIncreaseConflict("The approved prior cap changed. Submit a new capital increase request.")
            if _intent(current, token) != execution.intent:
                raise CapitalIncreaseConflict("The original capital execution configuration has changed.")
            execution.retry_of = retry_of
            execution.projected_at = None
            execution.save(update_fields=["retry_of", "projected_at", "updated_at"])
        else:
            token = ShareToken.objects.select_for_update().get(pk=request.token_id)
            current = CapitalIncreaseRequest.objects.select_for_update().get(pk=request.pk)
            existing = CapitalIncreaseExecution.objects.filter(request_id=current.pk).first()
            if existing is not None:
                return existing
            if current.dispatch_id is None or current.dispatch_id != request.dispatch_id:
                raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
            if current.status != RequestStatus.APPROVED or retry_of is not None:
                raise CapitalIncreaseConflict("Only a newly approved capital increase can be admitted.")
            _competing_history(current, token)
            execution = CapitalIncreaseExecution.objects.create(
                pk=current.dispatch_id,
                request_id=current.pk,
                token_id=token.pk,
                company_id=current.company_id,
                executed_by_id=actor.pk,
                intent=_intent(current, token),
            )
            if current.new_authorized_total <= int(token.total_supply):
                execution.projected_at = timezone.now()
                execution.save(update_fields=["projected_at", "updated_at"])
                current.mark_superseded(
                    "These approved terms do not raise the recorded cap "
                    f"({current.new_authorized_total} requested, {int(token.total_supply)} recorded). "
                    "Submit a new request."
                )
                return execution
        current.status = RequestStatus.EXECUTING
        current.save(update_fields=["status", "updated_at"])
        execute_review_request_task.defer(
            model_label=current._meta.label,
            request_uuid=str(current.pk),
            executed_by=execution.executed_by_id,
            execution_id=str(execution.pk),
        )
    return execution


def _retain_receipt(execution, operation):
    if operation.current_attempt_id is None:
        return
    record = execution.transaction
    if record is None or record.tx_hash != operation.current_attempt.tx_hash:
        raise CapitalIncreaseConflict("The capital execution is missing its original signed transaction association.")
    if operation.status not in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
        return
    record.status = (
        TransactionStatus.CONFIRMED if operation.status == OutgoingStatus.CONFIRMED else TransactionStatus.REVERTED
    )
    record.block_number = operation.block_number
    record.block_hash = operation.block_hash
    record.gas_used = operation.gas_used
    record.error_message = "" if operation.status == OutgoingStatus.CONFIRMED else "The original capital call reverted."
    record.confirmed_at = record.confirmed_at or timezone.now()
    record.save(
        update_fields=[
            "status",
            "block_number",
            "block_hash",
            "gas_used",
            "error_message",
            "confirmed_at",
            "updated_at",
        ]
    )


def _claim(execution):
    if execution.operation_id:
        with atomic(durable=True):
            current, _, _, operation = _lock(execution.pk, execution.operation_id)
            if operation.status == OutgoingStatus.REVERTED:
                _retain_receipt(current, operation)
            if operation.status not in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED) or (
                current.retry_of != operation.claim_id or current.attribution_evidence is not None
            ):
                return outgoing.OperationClaim(operation.pk, operation.claim_id)
            execution = current
    intent = {field: execution.intent[field] for field in INTENT_FIELDS}
    intent["value"] = int(intent["value"])
    claim = outgoing.open_operation(
        f"capital-increase:{execution.request_id}:{execution.pk}",
        **intent,
        restart_of=execution.retry_of or UUID(int=0),
    )
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        token = ShareToken.objects.select_for_update().get(pk=execution.token_id)
        request = CapitalIncreaseRequest.objects.select_for_update().get(pk=execution.request_id)
        current = CapitalIncreaseExecution.objects.select_for_update().get(pk=execution.pk)
        if current.operation_id == operation.pk and current.projected_at is not None:
            return outgoing.OperationClaim(operation.pk, operation.claim_id)
        if (
            current.operation_id not in (None, operation.pk)
            or request.dispatch_id != current.pk
            or request.token_id != token.pk
            or request.status != RequestStatus.EXECUTING
        ):
            raise CapitalIncreaseConflict("The original capital execution no longer owns this request.")
        current.operation = operation
        current.save(update_fields=["operation", "updated_at"])
        return outgoing.OperationClaim(operation.pk, operation.claim_id)


def _evidence(source, expected, observed):
    return {
        "reason": "The observed token state does not identify the admitted capital increase.",
        "source": source,
        "expected": expected,
        "observed": observed,
        "observed_at": timezone.now().isoformat(),
    }


def _hold(execution, evidence):
    if execution.attribution_evidence is None:
        execution.attribution_evidence = evidence
        execution.save(update_fields=["attribution_evidence", "updated_at"])


def _current_identity(token):
    return {
        "token": str(token.pk),
        "company": str(token.company_id),
        "contract": (token.contract_address or "").lower(),
        "chain": token.chain,
        "cap": str(int(token.total_supply)),
        "decimals": token.decimals,
    }


def _expected_identity(execution):
    return {
        "token": str(execution.token_id),
        "company": str(execution.company_id),
        "contract": execution.intent["to"],
        "chain": execution.intent["token_chain"],
        "cap": execution.intent["prior_authorized_total"],
        "decimals": 0,
    }


def _check_preparation(execution, claim, client):
    with atomic(durable=True):
        current, request, token, operation = _lock(execution.pk, claim.operation_id)
        if operation.claim_id != claim.claim_id:
            raise CapitalIncreaseConflict("Another capital attempt owns this preparation.")
        if current.projected_at is not None or operation.status != OutgoingStatus.PREPARING:
            return False
        expected, observed = _expected_identity(current), _current_identity(token)
        if expected != observed:
            _hold(current, _evidence("database", expected, observed))
        held = current.attribution_evidence is not None
        if not held and (request.status != RequestStatus.EXECUTING or _intent(request, token) != current.intent):
            raise CapitalIncreaseConflict("The original capital execution configuration or lifecycle has changed.")
    if held:
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
    if client.assert_expected_chain() != execution.intent["chain_id"]:
        raise CapitalIncreaseConflict("The provider is on a different chain from the admitted capital increase.")
    contract = client.load_contract("ShareToken", execution.intent["to"])
    authorized = contract.functions.authorizedShares().call()
    if type(authorized) is not int or authorized < 0:
        raise CapitalIncreaseUnresolved("The provider did not return a valid authorized share cap.")
    if authorized != int(execution.intent["prior_authorized_total"]):
        with atomic(durable=True):
            current, _, _, operation = _lock(execution.pk, claim.operation_id)
            if (
                operation.claim_id == claim.claim_id
                and operation.status == OutgoingStatus.PREPARING
                and operation.current_attempt_id is None
                and current.projected_at is None
            ):
                _hold(
                    current,
                    _evidence("chain", execution.intent["prior_authorized_total"], str(authorized)),
                )
        raise CapitalIncreaseConflict(ATTRIBUTION_REQUIRED)
    return True


def _record_signed(execution_id, attempt):
    execution, request, token, operation = _lock(execution_id, attempt.operation_id)
    if (
        execution.attribution_evidence is not None
        or execution.projected_at is not None
        or request.status != RequestStatus.EXECUTING
        or operation.claim_id != attempt.claim_id
        or _current_identity(token) != _expected_identity(execution)
        or _intent(request, token) != execution.intent
    ):
        raise CapitalIncreaseConflict("The admitted capital identity or configuration changed before signing.")
    intent = execution.intent
    record = BlockchainTransaction.objects.create(
        tx_hash=attempt.tx_hash,
        tx_type=TransactionType.OTHER,
        status=TransactionStatus.SUBMITTED,
        from_address=intent["sender"],
        to_address=intent["to"],
        function_name="setAuthorizedShares",
        function_args={"newAuthorizedShares": intent["new_authorized_total"]},
        related_model="tokens.CapitalIncreaseRequest",
        related_uuid=execution.request_id,
        submitted_at=attempt.created_at,
    )
    execution.transaction = record
    execution.save(update_fields=["transaction", "updated_at"])


def _preparation_failed(execution, claim):
    with atomic(durable=True):
        current, _, token, operation = _lock(execution.pk, claim.operation_id)
        if (
            operation.claim_id != claim.claim_id
            or operation.status != OutgoingStatus.PREPARING
            or operation.current_attempt_id is not None
            or current.projected_at is not None
        ):
            return False
        expected, observed = _expected_identity(current), _current_identity(token)
        if expected != observed:
            _hold(current, _evidence("database", expected, observed))
        if current.attribution_evidence is not None:
            return False
    return outgoing.fail_preparing(claim)


def _verified_receipt(execution, operation, client):
    if client.assert_expected_chain() != execution.intent["chain_id"]:
        raise CapitalIncreaseUnresolved()
    tx_hash = operation.current_attempt.tx_hash
    receipt = client.get_transaction_receipt(tx_hash)
    if receipt is None:
        raise CapitalIncreaseUnresolved()
    if (
        type(receipt.get("status")) is not int
        or receipt["status"] != 1
        or Web3.to_hex(HexBytes(receipt.get("transactionHash", b""))) != tx_hash
        or receipt.get("blockNumber") != operation.block_number
        or Web3.to_hex(HexBytes(receipt.get("blockHash", b""))) != operation.block_hash
        or str(receipt.get("to", "")).lower() != execution.intent["to"]
        or str(receipt.get("from", "")).lower() != execution.intent["sender"]
    ):
        raise CapitalIncreaseUnresolved("The receipt does not identify the original capital transaction.")
    contract = client.load_contract("ShareToken", execution.intent["to"])
    events = contract.events.AuthorizedSharesUpdated().process_receipt(receipt, errors=DISCARD)
    original_events = [event for event in events if event["address"].lower() == execution.intent["to"]]
    matches = [
        event
        for event in original_events
        if int(event["args"]["oldAmount"]) == int(execution.intent["prior_authorized_total"])
        and int(event["args"]["newAmount"]) == int(execution.intent["new_authorized_total"])
    ]
    if len(matches) != 1:
        if original_events:
            with atomic(durable=True):
                current, _, _, locked = _lock(execution.pk, operation.pk)
                if locked.claim_id == operation.claim_id and current.projected_at is None:
                    _hold(
                        current,
                        _evidence(
                            "receipt",
                            {
                                "old": execution.intent["prior_authorized_total"],
                                "new": execution.intent["new_authorized_total"],
                            },
                            {
                                "tx_hash": tx_hash,
                                "events": [
                                    {"old": str(event["args"]["oldAmount"]), "new": str(event["args"]["newAmount"])}
                                    for event in original_events
                                ],
                            },
                        ),
                    )
            return False
        raise CapitalIncreaseUnresolved("The receipt has no unique capital event matching the approved terms.")
    return True


def _project(execution, claim, *, verified=False):
    with atomic(durable=True):
        current, request, token, operation = _lock(execution.pk, claim.operation_id)
        if operation.claim_id != claim.claim_id:
            raise CapitalIncreaseConflict("A newer capital attempt owns this outcome.")
        if current.projected_at is not None:
            return current
        _retain_receipt(current, operation)
        if current.attribution_evidence is not None or current.retry_of == operation.claim_id:
            return current
        if operation.status == OutgoingStatus.CONFIRMED:
            if not verified:
                return current
            expected, observed = _expected_identity(current), _current_identity(token)
            if expected != observed:
                _hold(current, _evidence("database", expected, observed))
                return current
        elif operation.status not in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
            return current
        current.projected_at = timezone.now()
        current.save(update_fields=["projected_at", "updated_at"])
        if operation.status == OutgoingStatus.CONFIRMED:
            request.mark_executed()
            token.total_supply = current.intent["new_authorized_total"]
            token.save(update_fields=["total_supply", "updated_at"])
        else:
            reason = (
                "The original capital transaction reverted."
                if operation.status == OutgoingStatus.REVERTED
                else "Capital preparation failed before a transaction was signed."
            )
            request.mark_failed(reason)
        return current


def _result(execution):
    execution = (
        CapitalIncreaseExecution.objects.select_related("transaction")
        .annotate(
            request_status=Subquery(
                CapitalIncreaseRequest.objects.filter(pk=OuterRef("request_id")).values("status")[:1]
            )
        )
        .get(pk=execution.pk)
    )
    record = execution.transaction
    return {
        "status": execution.request_status,
        "tx_hash": record.tx_hash if record else None,
        "block_number": record.block_number if record else None,
        "gas_used": record.gas_used if record else None,
        "new_authorized_total": int(execution.intent["new_authorized_total"]),
        "attribution_required": execution.attribution_evidence is not None,
    }


def recover(execution_id):
    _boundary()
    execution = CapitalIncreaseExecution.objects.get(pk=execution_id)
    if execution.projected_at is not None or (
        execution.attribution_evidence is not None and execution.operation_id is None
    ):
        return _result(execution)
    claim = _claim(execution)
    execution.refresh_from_db()
    if execution.projected_at is not None:
        return _result(execution)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
        return _result(_project(execution, claim))
    if execution.attribution_evidence is not None and operation.status != OutgoingStatus.SIGNED:
        return _result(_project(execution, claim))
    client = get_base_chain_client()
    if operation.status == OutgoingStatus.PREPARING:
        try:
            if _check_preparation(execution, claim, client):
                prepared = outgoing.prepare_operation(claim, client)
                if _check_preparation(execution, claim, client):
                    outgoing.sign_operation(
                        claim,
                        prepared,
                        settings.BLOCKCHAIN_OPERATOR_KEY,
                        on_signed=lambda attempt: _record_signed(execution.pk, attempt),
                    )
        except Exception:
            logger.warning("Capital execution %s requires committed-state recovery", execution.pk)
            _preparation_failed(execution, claim)
    operation.refresh_from_db()
    execution.refresh_from_db()
    if operation.claim_id != claim.claim_id:
        return _result(execution)
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
        execution.refresh_from_db()
        if operation.status == OutgoingStatus.SIGNED and execution.attribution_evidence is None:
            outgoing.broadcast_operation(claim, client)
            outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
    if operation.status == OutgoingStatus.CONFIRMED:
        with atomic(durable=True):
            current, _, _, locked = _lock(execution.pk, claim.operation_id)
            if locked.claim_id != claim.claim_id:
                return _result(current)
            _retain_receipt(current, locked)
    verified = (
        _verified_receipt(execution, operation, client)
        if operation.status == OutgoingStatus.CONFIRMED and execution.attribution_evidence is None
        else False
    )
    return _result(_project(execution, claim, verified=verified))
