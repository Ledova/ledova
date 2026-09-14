import hashlib
import logging
from contextlib import contextmanager
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connections
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
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias
from whitelist.constants import WHITELIST_RECOVERY_LIMIT
from whitelist.exceptions import (
    WalletNotRegisteredException,
    WhitelistChangeConflict,
    WhitelistChangeUnresolved,
)
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistEntry,
    WhitelistStatus,
)

logger = logging.getLogger(__name__)
FUNCTIONS = {WhitelistAction.ADD: "addToWhitelist", WhitelistAction.REMOVE: "removeFromWhitelist"}
PERMISSIONS = {
    WhitelistAuthority.OPERATOR_API: None,
    WhitelistAuthority.WHITELIST_ADMIN: "whitelist.change_whitelistentry",
    WhitelistAuthority.SUBSCRIPTION_ADMIN: "offerings.change_subscription",
}
TERMINAL = (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED, WhitelistChangeStatus.FAILED)


def _boundary():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Whitelist changes require operator authority.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise WhitelistChangeConflict("Whitelist changes require autocommit outside every transaction block.")


def _authorize(user, authority):
    if authority not in PERMISSIONS:
        raise PermissionDenied("The whitelist entry point is not authorized.")
    actor = get_user_model().objects.get(pk=user.pk)
    permission = PERMISSIONS[authority]
    if not actor.is_active or not actor.is_staff or (permission and not actor.has_perm(permission)):
        raise PermissionDenied("You cannot submit this whitelist change.")
    return actor


def _identity(action, address):
    if action not in FUNCTIONS or not Web3.is_address(address):
        raise WhitelistChangeConflict("The whitelist action or address is invalid.")
    address = Web3.to_checksum_address(address).lower()
    try:
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        data = Web3.keccak(text=f"{FUNCTIONS[action]}(address)")[:4] + encode(["address"], [address])
        intent = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            sender=sender,
            to=settings.WHITELIST_CONTRACT_ADDRESS,
            data=data,
        )
    except (TypeError, ValueError, AttributeError):
        raise WhitelistChangeConflict("The whitelist registry or signing identity is not configured.") from None
    if intent["to"] is None:
        raise WhitelistChangeConflict("The whitelist registry is not configured.")
    return address, intent


@contextmanager
def target_transaction(chain_id, registry_address, address):
    key = f"whitelist:{chain_id}:{registry_address.lower()}:{address.lower()}"
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    with atomic(durable=True):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])
        yield


def _target(change):
    return target_transaction(change.chain_id, change.registry_address, change.address)


def _resolve_entry(action, address, wallet_uuid):
    from whitelist.services.whitelist import resolve_entry

    if action == WhitelistAction.ADD:
        return resolve_entry(address, wallet_uuid=wallet_uuid)
    entries = list(WhitelistEntry.objects.filter_by_address(address).order_by("uuid")[:2])
    if len(entries) > 1:
        raise WalletNotRegisteredException()
    return entries[0] if entries else None


def _same_submission(change, action, address, actor, authority, wallet_uuid):
    if (
        change.action != action
        or change.address != address
        or change.initiated_by_id != actor.pk
        or change.authority != authority
        or change.requested_wallet_id != wallet_uuid
    ):
        raise WhitelistChangeConflict("This submission already identifies different whitelist terms or authority.")


def _admit(submission_id, action, address, user, authority, wallet_uuid):
    actor = _authorize(user, authority)
    try:
        submission_id = UUID(str(submission_id))
        wallet_uuid = UUID(str(wallet_uuid)) if wallet_uuid is not None else None
    except (ValueError, TypeError):
        raise WhitelistChangeConflict("A whitelist submission requires a valid UUID.") from None
    if not Web3.is_address(address):
        raise WhitelistChangeConflict("The whitelist address is invalid.")
    address = Web3.to_checksum_address(address).lower()
    previous = WhitelistChange.objects.filter(pk=submission_id).first()
    if previous is not None:
        _same_submission(previous, action, address, actor, authority, wallet_uuid)
        return previous
    address, intent = _identity(action, address)
    with target_transaction(intent["chain_id"], intent["to"], address):
        actor = _authorize(user, authority)
        previous = WhitelistChange.objects.select_for_update().filter(pk=submission_id).first()
        if previous is not None:
            _same_submission(previous, action, address, actor, authority, wallet_uuid)
            return previous
        if WhitelistChange.objects.for_target(intent["chain_id"], intent["to"], address).unresolved().exists():
            raise WhitelistChangeConflict(
                "An earlier whitelist change for this address is unresolved. Recover it first."
            )
        if (
            BlockchainTransaction.objects.filter(
                tx_type__in=[TransactionType.WHITELIST_ADD, TransactionType.WHITELIST_REMOVE],
                to_address__iexact=intent["to"],
                function_args__investor__iexact=address,
            )
            .exclude(related_model="whitelist.WhitelistChange")
            .exclude(status__in=[TransactionStatus.CONFIRMED, TransactionStatus.REVERTED])
            .exists()
        ):
            raise WhitelistChangeConflict("Historical whitelist work for this address requires operator attribution.")
        entry = _resolve_entry(action, address, wallet_uuid)
        change, _ = WhitelistChange.objects.get_or_create(
            pk=submission_id,
            defaults={
                "action": action,
                "address": address,
                "chain_id": intent["chain_id"],
                "registry_address": intent["to"],
                "intent": intent,
                "initiated_by": actor,
                "authority": authority,
                "requested_wallet_id": wallet_uuid,
                "entry": entry,
            },
        )
        _same_submission(change, action, address, actor, authority, wallet_uuid)
        if entry:
            WhitelistEntry.objects.filter(pk=entry.pk).update(status=WhitelistStatus.PENDING, updated_at=timezone.now())
        return change


def _observe_membership(change, client):
    if _identity(change.action, change.address)[1] != change.intent:
        raise WhitelistChangeConflict("The whitelist configuration changed after admission.")
    if client.assert_expected_chain() != change.chain_id:
        raise WhitelistChangeConflict("The whitelist provider is on another chain.")
    contract = client.load_contract("WhitelistRegistry", Web3.to_checksum_address(change.registry_address))
    return contract.functions.isWhitelisted(Web3.to_checksum_address(change.address)).call()


def _record_membership_decision(change, member):
    if type(member) is not bool:
        raise WhitelistChangeUnresolved()
    with _target(change):
        current = WhitelistChange.objects.select_for_update().get(pk=change.pk)
        if current.status != WhitelistChangeStatus.PENDING:
            return current
        if member == (change.action == WhitelistAction.ADD):
            current.status = WhitelistChangeStatus.UNCHANGED
            current.completed_at = timezone.now()
            if current.entry_id:
                WhitelistEntry.objects.filter(pk=current.entry_id).update(
                    status=WhitelistStatus.ACTIVE if member else WhitelistStatus.REMOVED,
                    is_whitelisted=member,
                    last_synced_at=current.completed_at,
                    updated_at=current.completed_at,
                )
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
                "function_name": FUNCTIONS[change.action],
                "function_args": {"investor": change.address},
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
            if current.entry_id:
                values = {"status": WhitelistStatus.FAILED, "updated_at": current.completed_at}
                if current.status == WhitelistChangeStatus.CONFIRMED:
                    member = current.action == WhitelistAction.ADD
                    values |= {
                        "status": WhitelistStatus.ACTIVE if member else WhitelistStatus.REMOVED,
                        "is_whitelisted": member,
                        "last_synced_at": current.completed_at,
                        "add_tx_hash" if member else "remove_tx_hash": attempt.tx_hash,
                    }
                WhitelistEntry.objects.filter(pk=current.entry_id).update(**values)
        current.save(update_fields=["status", "transaction", "failure_code", "completed_at", "updated_at"])
        return current


def _process(change):
    if change.status in TERMINAL:
        return change
    client = get_base_chain_client()
    if change.status == WhitelistChangeStatus.PENDING:
        member = _observe_membership(change, client)
        change = _record_membership_decision(change, member)
        if change.status in TERMINAL:
            return change
    claim = _claim(change)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in (OutgoingStatus.CONFIRMED, OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
        return _project(change, claim)
    if operation.status == OutgoingStatus.PREPARING:
        try:
            if _identity(change.action, change.address)[1] != change.intent:
                raise WhitelistChangeConflict("The whitelist signing configuration changed after admission.")
            prepared = outgoing.prepare_operation(claim, client)
            if _identity(change.action, change.address)[1] != change.intent:
                raise WhitelistChangeConflict("The whitelist signing configuration changed during preparation.")
        except Exception:
            outgoing.fail_preparing(claim)
            return _project(change, claim)
        outgoing.sign_operation(claim, prepared, settings.BLOCKCHAIN_OPERATOR_KEY)
    current = _project(change, claim)
    if current.status in TERMINAL:
        return current
    outgoing.reconcile_operation(claim, client)
    operation.refresh_from_db()
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.broadcast_operation(claim, client)
        outgoing.reconcile_operation(claim, client)
    return _project(change, claim)


def submit(submission_id, action, address, user, *, authority=WhitelistAuthority.OPERATOR_API, wallet_uuid=None):
    _boundary()
    change = _admit(submission_id, action, address, user, authority, wallet_uuid)
    try:
        return _process(change)
    except (PermissionDenied, WhitelistChangeConflict):
        raise
    except Exception:
        logger.warning("Whitelist recovery remains unresolved: submission=%s", change.pk)
        raise WhitelistChangeUnresolved() from None


def recover(submission_id):
    _boundary()
    change = WhitelistChange.objects.get(pk=submission_id)
    return _process(change)


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
