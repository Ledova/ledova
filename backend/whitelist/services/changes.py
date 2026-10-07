import hashlib
import logging
from contextlib import contextmanager
from uuid import UUID

from django.conf import settings
from django.db import IntegrityError, connections
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from rest_framework.exceptions import PermissionDenied
from web3 import Web3

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    OutgoingStatus,
    TransactionStatus,
    TransactionType,
)
from blockchain.services import outgoing
from companies.models import Company
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias
from whitelist.constants import WHITELIST_NO_EXPIRY, WHITELIST_RECOVERY_LIMIT
from whitelist.exceptions import (
    WhitelistChangeConflict,
    WhitelistChangeUnresolved,
    WhitelistRegistryMissing,
    WhitelistSigningHold,
)
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistStatus,
)
from whitelist.services.whitelist import (
    approval_values,
    project_membership,
    registry_contract,
    registry_for,
    with_current_approval,
)

logger = logging.getLogger(__name__)
FUNCTION = "setExpiry"
SELECTOR = Web3.keccak(text=f"{FUNCTION}(address,uint64)")[:4]
TERMINAL = (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED, WhitelistChangeStatus.FAILED)


def _boundary():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Whitelist changes require operator authority.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise WhitelistChangeConflict("Whitelist changes require autocommit outside every transaction block.")


def on_chain_expiry(action, expires_at):
    if action == WhitelistAction.REMOVE:
        return 0
    return WHITELIST_NO_EXPIRY if expires_at is None else int(expires_at.timestamp())


def _intent(action, address, registry_address, expires_at):
    if action not in (WhitelistAction.ADD, WhitelistAction.REMOVE) or not Web3.is_address(address):
        raise WhitelistChangeConflict("The whitelist action or address is invalid.")
    address = Web3.to_checksum_address(address).lower()
    try:
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        data = SELECTOR + encode(["address", "uint64"], [address, on_chain_expiry(action, expires_at)])
        return outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            sender=sender,
            to=registry_address,
            data=data,
        )
    except (TypeError, ValueError, AttributeError):
        raise WhitelistChangeConflict("The whitelist signing identity is not configured.") from None


def _change_intent(change):
    return _intent(change.action, change.address, change.registry_address, change.expires_at)


@contextmanager
def target_transaction(chain_id, registry_address, address):
    with atomic(durable=True):
        lock_target(chain_id, registry_address, address)
        yield


def lock_target(chain_id, registry_address, address):
    key = f"whitelist:{chain_id}:{registry_address.lower()}:{address.lower()}"
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])


def _target(change):
    return target_transaction(change.chain_id, change.registry_address, change.address)


def _same_submission(change, action, address, actor, authority, wallet_uuid, company, expires_at):
    if (
        change.action != action
        or change.address != address
        or change.initiated_by_id != actor.pk
        or change.authority != authority
        or change.requested_wallet_id != wallet_uuid
        or change.company_id != company.pk
        or change.expires_at != expires_at
    ):
        raise WhitelistChangeConflict("This submission already identifies different whitelist terms or authority.")


def _observe_membership(change, client):
    if _change_intent(change) != change.intent:
        raise WhitelistChangeConflict("The whitelist configuration changed after admission.")
    if client.assert_expected_chain() != change.chain_id:
        raise WhitelistChangeConflict("The whitelist provider is on another chain.")
    try:
        registry = registry_for(Company.objects.get(pk=change.company_id), client)
    except WhitelistRegistryMissing:
        registry = None
    if registry != change.registry_address:
        raise WhitelistChangeConflict("The company's whitelist registry changed after admission.")
    contract = registry_contract(change.registry_address, client)
    return contract.functions.expiresAt(Web3.to_checksum_address(change.address)).call()


def _project_observation(change, expiry, moment):
    if change.entry_id:
        project_membership(
            change.entry_id,
            change.address,
            change.chain_id,
            change.registry_address,
            change.company_id,
            approval_values(expiry) | {"last_synced_at": moment, "updated_at": moment},
        )


def _record_membership_decision(change, expiry):
    if type(expiry) is not int:
        raise WhitelistChangeUnresolved()
    with _target(change):
        current = WhitelistChange.objects.select_for_update().get(pk=change.pk)
        if current.status != WhitelistChangeStatus.PENDING:
            return current
        if expiry == on_chain_expiry(current.action, current.expires_at):
            current.status = WhitelistChangeStatus.UNCHANGED
            current.completed_at = timezone.now()
            _project_observation(current, expiry, current.completed_at)
        else:
            current.status = WhitelistChangeStatus.EXECUTING
        current.save(update_fields=["status", "completed_at", "updated_at"])
        return current


def _claim(change):
    intent = change.intent | {"value": int(change.intent["value"])}
    claim = outgoing.open_operation(f"whitelist-change:{change.pk}", **intent, restart_of=UUID(int=0))
    with _target(change):
        current = WhitelistChange.objects.select_for_update().get(pk=change.pk)
        if current.status != WhitelistChangeStatus.EXECUTING or current.operation_id not in (None, claim.operation_id):
            if current.status in TERMINAL and current.operation_id == claim.operation_id:
                return claim
            raise WhitelistChangeConflict("The whitelist operation association changed.")
        current.operation_id = claim.operation_id
        current.save(update_fields=["operation", "updated_at"])
    return claim


def _project(change, claim):
    with _target(change):
        current = WhitelistChange.objects.select_for_update().get(pk=change.pk)
        if current.status in TERMINAL:
            return current
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        if current.operation_id != operation.pk or operation.claim_id != claim.claim_id:
            raise WhitelistChangeConflict("The whitelist outcome belongs to another operation.")
        attempt = operation.current_attempt
        if attempt:
            expected = {
                "tx_type": (
                    TransactionType.WHITELIST_ADD
                    if change.action == WhitelistAction.ADD
                    else TransactionType.WHITELIST_REMOVE
                ),
                "from_address": change.intent["sender"],
                "to_address": change.registry_address,
                "function_name": FUNCTION,
                "function_args": {
                    "investor": change.address,
                    "expiry": str(on_chain_expiry(change.action, change.expires_at)),
                },
                "related_model": "whitelist.WhitelistChange",
                "related_uuid": change.pk,
            }
            record, _ = BlockchainTransaction.objects.get_or_create(tx_hash=attempt.tx_hash, defaults=expected)
            if any(getattr(record, field) != value for field, value in expected.items()):
                raise WhitelistChangeConflict("The whitelist transaction hash belongs to different work.")
            record.status = {
                OutgoingStatus.SIGNED: TransactionStatus.SUBMITTED,
                OutgoingStatus.CONFIRMED: TransactionStatus.CONFIRMED,
                OutgoingStatus.REVERTED: TransactionStatus.REVERTED,
            }[operation.status]
            record.submitted_at = record.submitted_at or attempt.created_at
            record.block_number = operation.block_number
            record.block_hash = operation.block_hash or None
            record.gas_used = operation.gas_used
            if operation.status == OutgoingStatus.CONFIRMED:
                record.confirmed_at = record.confirmed_at or timezone.now()
            record.save(
                update_fields=[
                    "status",
                    "submitted_at",
                    "block_number",
                    "block_hash",
                    "gas_used",
                    "confirmed_at",
                    "updated_at",
                ]
            )
            current.transaction = record
        current.status = {
            OutgoingStatus.PREPARING: WhitelistChangeStatus.EXECUTING,
            OutgoingStatus.SIGNED: WhitelistChangeStatus.EXECUTING,
            OutgoingStatus.CONFIRMED: WhitelistChangeStatus.CONFIRMED,
            OutgoingStatus.FAILED: WhitelistChangeStatus.FAILED,
            OutgoingStatus.REVERTED: WhitelistChangeStatus.FAILED,
        }[operation.status]
        current.failure_code = operation.status if current.status == WhitelistChangeStatus.FAILED else ""
        if current.status in TERMINAL:
            current.completed_at = timezone.now()
            if current.status == WhitelistChangeStatus.CONFIRMED:
                _project_observation(current, on_chain_expiry(current.action, current.expires_at), current.completed_at)
            elif current.entry_id:
                project_membership(
                    current.entry_id,
                    current.address,
                    current.chain_id,
                    current.registry_address,
                    current.company_id,
                    {"status": WhitelistStatus.FAILED, "updated_at": current.completed_at},
                )
        current.save(update_fields=["status", "transaction", "failure_code", "completed_at", "updated_at"])
        return current


def _process(change):
    if change.status in TERMINAL:
        return change
    client = get_base_chain_client()
    if change.status == WhitelistChangeStatus.PENDING:
        expiry = _observe_membership(change, client)
        change = _record_membership_decision(change, expiry)
        if change.status in TERMINAL:
            return change
    claim = _claim(change)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in (OutgoingStatus.CONFIRMED, OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
        return _project(change, claim)
    if operation.status == OutgoingStatus.PREPARING:
        try:
            if _change_intent(change) != change.intent:
                raise WhitelistChangeConflict("The whitelist signing configuration changed after admission.")
            prepared = outgoing.prepare_operation(claim, client)
            if _change_intent(change) != change.intent:
                raise WhitelistChangeConflict("The whitelist signing configuration changed during preparation.")
        except Exception:
            outgoing.fail_preparing(claim)
            return _project(change, claim)
        from whitelist.services.company_wallet_instructions import signing_source

        try:
            outgoing.sign_operation(
                claim,
                prepared,
                settings.BLOCKCHAIN_OPERATOR_KEY,
                signing_context=(
                    (lambda: signing_source(change, claim))
                    if change.authority != WhitelistAuthority.CLASSIFICATION_REFRESH
                    else None
                ),
            )
        except WhitelistSigningHold as error:
            if "source_lock_busy" not in error.unmet_requirements:
                outgoing.fail_preparing(claim)
            return _project(change, claim)
        except IntegrityError:
            outgoing.fail_preparing(claim)
            return _project(change, claim)
    current = _project(change, claim)
    if current.status in TERMINAL:
        return current
    outgoing.reconcile_operation(claim, client)
    operation.refresh_from_db()
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.broadcast_operation(claim, client)
        outgoing.reconcile_operation(claim, client)
    return _project(change, claim)


def submit(
    submission_id,
    action,
    address,
    user,
    *,
    company,
    expires_at=None,
    authority=WhitelistAuthority.OPERATOR_API,
    wallet_uuid=None,
):
    _boundary()
    try:
        submission_id = UUID(str(submission_id))
        wallet_uuid = UUID(str(wallet_uuid)) if wallet_uuid is not None else None
    except (ValueError, TypeError):
        raise WhitelistChangeConflict("A whitelist recovery requires valid original identifiers.") from None
    if not isinstance(company, Company) or not Web3.is_address(address):
        raise WhitelistChangeConflict("A whitelist recovery requires its exact original company and address.")
    change = WhitelistChange.objects.filter(pk=submission_id).first()
    if change is None:
        raise PermissionDenied("New wallet changes require a retained company instruction.")
    address = Web3.to_checksum_address(address).lower()
    requested = expires_at.replace(microsecond=0) if expires_at is not None else None
    _same_submission(change, action, address, user, authority, wallet_uuid, company, requested)
    try:
        return with_current_approval(_process(change))
    except (PermissionDenied, WhitelistChangeConflict):
        raise
    except Exception:
        logger.warning("Whitelist recovery remains unresolved: submission=%s", change.pk)
        raise WhitelistChangeUnresolved() from None


def recover(submission_id):
    _boundary()
    change = WhitelistChange.objects.get(pk=submission_id)
    return with_current_approval(_process(change))


def recover_changes():
    _boundary()
    result = {"checked": 0, "completed": 0, "unresolved": 0}
    for change_id in WhitelistChange.objects.for_recovery().values_list("uuid", flat=True)[:WHITELIST_RECOVERY_LIMIT]:
        result["checked"] += 1
        try:
            change = recover(change_id)
            result["completed" if change.status in TERMINAL else "unresolved"] += 1
        except Exception:
            result["unresolved"] += 1
            WhitelistChange.objects.filter(pk=change_id).update(updated_at=timezone.now())
            logger.warning("Whitelist recovery remains unresolved: submission=%s", change_id)
    return result


def submit_invalidation(submission_id, command):
    from whitelist.services.eligibility_invalidation import admit_invalidation

    _boundary()
    change = admit_invalidation(submission_id, command)
    if change is None:
        return None
    try:
        return with_current_approval(_process(change))
    except (PermissionDenied, WhitelistChangeConflict):
        raise
    except Exception:
        logger.warning("Whitelist invalidation remains unresolved: submission=%s", change.pk)
        raise WhitelistChangeUnresolved() from None
