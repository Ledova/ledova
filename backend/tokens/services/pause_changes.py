import hashlib
from contextlib import contextmanager

from django.conf import settings
from django.db import connections
from django.utils import timezone
from eth_account import Account
from web3 import Web3

from blockchain.models import OutgoingOperation, OutgoingStatus, SignedAttempt
from blockchain.services import outgoing
from companies.models import Company
from companies.services.administration import company_operation
from shared.db import atomic, current_alias
from shared.tasks.queue import defer
from tokens.exceptions import InvalidTokenStateException, PauseChangeConflict
from tokens.models import (
    PauseAuthority,
    PauseChange,
    PauseChangeStatus,
    RegisterPauseChange,
    ShareToken,
    ShareTokenStatus,
)

TERMINAL = (PauseChangeStatus.OBSERVED, PauseChangeStatus.CONFIRMED, PauseChangeStatus.FAILED)


def require_autocommit():
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise PauseChangeConflict("Pause recovery requires autocommit outside every transaction block.")


def require_pausable(token):
    if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED) or token.chain != "base":
        raise InvalidTokenStateException("Only deployed or paused Base tokens can accept a pause or unpause request.")


def transaction_intent(token, paused):
    require_pausable(token)
    try:
        intent = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            sender=Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address,
            to=token.contract_address,
            data=Web3.keccak(text="pause()" if paused else "unpause()")[:4],
        )
    except (TypeError, ValueError, AttributeError, outgoing.OutgoingTransactionError):
        raise PauseChangeConflict("The pause contract, chain or signing identity is not configured.") from None
    if intent["to"] is None or intent["to"] == "0x" + "0" * 40:
        raise PauseChangeConflict("The pause contract is not configured.")
    return intent


def lock_target(chain_id, contract_address):
    key = f"pause:{chain_id}:{contract_address.lower()}"
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])


@contextmanager
def target_transaction(chain_id, contract_address):
    with atomic(durable=True):
        lock_target(chain_id, contract_address)
        yield


def operation_key(change):
    return f"token-pause:{change.pk}"


def admit_company(proposal, actor):
    from tokens.tasks.pause import recover_pause_change

    if (
        PauseChange.objects.unresolved()
        .filter(chain_id=proposal.intent["chain_id"], contract_address=proposal.intent["to"])
        .exists()
    ):
        raise PauseChangeConflict()
    change = PauseChange.objects.create(
        pk=proposal.pk,
        source_pause=proposal,
        token_id=proposal.token_id,
        company_id=proposal.company_id,
        initiated_by=actor,
        authority=PauseAuthority.COMPANY,
        paused=proposal.paused,
        chain_id=proposal.intent["chain_id"],
        contract_address=proposal.intent["to"],
        intent=proposal.intent,
    )
    defer(recover_pause_change, submission_id=str(change.pk))
    return change


def lock_original(change_id):
    initial = PauseChange.objects.get(pk=change_id)
    Company.objects.select_for_update().filter(pk=initial.company_id).first()
    ShareToken.objects.select_for_update().filter(pk=initial.token_id, company_id=initial.company_id).first()
    RegisterPauseChange.objects.select_for_update().get(pk=initial.source_pause_id)
    return PauseChange.objects.select_for_update().get(pk=change_id)


def check_authority(change):
    from tokens.exceptions import PauseSigningHold
    from tokens.services.register_pause_changes import execution_requirements

    unmet = execution_requirements(change.source_pause)
    if unmet:
        raise PauseSigningHold(unmet)


def record_decision(change, paused, observation):
    with target_transaction(change.chain_id, change.contract_address):
        current = lock_original(change.pk)
        if current.status != PauseChangeStatus.PENDING:
            return current
        check_authority(current)
        if current.operation_id or OutgoingOperation.objects.filter(operation_key=operation_key(current)).exists():
            raise PauseChangeConflict("An outgoing pause operation already owns this decision.")
        current.status = PauseChangeStatus.OBSERVED if paused == current.paused else PauseChangeStatus.EXECUTING
        current.observation = observation if current.status == PauseChangeStatus.OBSERVED else None
        current.save(update_fields=["status", "observation", "updated_at"])
        return current


def retire_lapsed_source(change):
    from tokens.services.register_pause_changes import permanent_source_loss

    if not permanent_source_loss(change.source_pause):
        return False
    with target_transaction(change.chain_id, change.contract_address):
        current = lock_original(change.pk)
        operation = OutgoingOperation.objects.select_for_update().filter(operation_key=operation_key(current)).first()
        if (
            current.completed_at is not None
            or current.status not in (PauseChangeStatus.PENDING, PauseChangeStatus.EXECUTING)
            or not permanent_source_loss(current.source_pause)
        ):
            return False
        if operation is not None:
            if (
                operation.status != OutgoingStatus.PREPARING
                or SignedAttempt.objects.filter(operation=operation).exists()
            ):
                return False
            operation.status = OutgoingStatus.FAILED
            operation.save(update_fields=["status", "updated_at"])
            current.operation = operation
        current.status = PauseChangeStatus.FAILED
        current.completed_at = timezone.now()
        current.save(update_fields=["status", "operation", "completed_at", "updated_at"])
        return True


def project(change_id):
    change = PauseChange.objects.get(pk=change_id)
    with company_operation(change.initiated_by, change.company_id, "register_pause_project"), target_transaction(
        change.chain_id, change.contract_address
    ):
        current = lock_original(change_id)
        if current.completed_at is not None or current.status not in TERMINAL:
            return current
        if current.status != PauseChangeStatus.FAILED:
            with atomic():
                company = Company.objects.select_for_update().filter(pk=current.company_id).first()
                token = (
                    ShareToken.objects.select_for_update()
                    .filter(pk=current.token_id, company_id=current.company_id)
                    .first()
                )
                if (
                    company is None
                    or token is None
                    or token.chain != "base"
                    or (token.contract_address or "").lower() != current.contract_address
                    or settings.BLOCKCHAIN_CHAIN_ID != current.chain_id
                    or token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED)
                ):
                    raise PauseChangeConflict("The original pause target cannot currently receive its outcome.")
                desired = ShareTokenStatus.PAUSED if current.paused else ShareTokenStatus.DEPLOYED
                if token.status != desired:
                    token.status = desired
                    token.save(update_fields=["status", "updated_at"])
        current.completed_at = timezone.now()
        current.save(update_fields=["completed_at", "updated_at"])
        return current


def message(change):
    action = "Pause" if change.paused else "Unpause"
    if change.completed_at is None:
        return f"{action} request retained. Its outcome is pending; this does not establish the current token state."
    if change.status == PauseChangeStatus.FAILED:
        if change.operation_id is None:
            return (
                f"The original {action.lower()} request was refused before signing. "
                "A new request needs a new submission."
            )
        return f"The original {action.lower()} request failed. A deliberate new attempt needs a new submission."
    if change.status == PauseChangeStatus.OBSERVED:
        return f"The token was already in the requested state when this {action.lower()} request was checked."
    return f"The original {action.lower()} transaction was confirmed. The token may have changed since then."
