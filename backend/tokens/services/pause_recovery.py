from uuid import UUID

from django.conf import settings
from django.utils import timezone
from eth_account import Account
from hexbytes import HexBytes
from rest_framework.exceptions import PermissionDenied
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import OutgoingOperation, OutgoingStatus
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.exceptions import InvalidTokenStateException, PauseChangeConflict
from tokens.models import PauseChange, PauseChangeStatus
from tokens.services import pause_changes

FAILED = (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)


def _configuration(change, client):
    if (
        settings.BLOCKCHAIN_CHAIN_ID != change.chain_id
        or Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower() != change.intent["sender"]
        or client.assert_expected_chain() != change.chain_id
    ):
        raise PauseChangeConflict("The pause chain or signer changed after admission.")
    with atomic(durable=True):
        current = PauseChange.objects.select_for_update().get(pk=change.pk)
        pause_changes.check_authority(current)


def _decide(change, client):
    try:
        _configuration(change, client)
    except (PauseChangeConflict, InvalidTokenStateException, PermissionDenied, ValueError):
        return pause_changes.refuse_unsigned(change)
    block = client.get_block("latest")
    number = block["number"]
    block_hash = Web3.to_hex(HexBytes(block["hash"]))
    if type(number) is not int or number < 0 or len(HexBytes(block_hash)) != 32:
        raise PauseChangeConflict("The pause observation has no valid block identity.")
    contract = client.load_contract("ShareToken", Web3.to_checksum_address(change.contract_address))
    paused = contract.functions.paused().call(block_identifier=block_hash)
    if type(paused) is not bool:
        raise PauseChangeConflict("The pause observation is not a verified boolean.")
    try:
        return pause_changes.record_decision(
            change,
            paused,
            {"block_number": number, "block_hash": block_hash, "observed_at": timezone.now().isoformat()},
        )
    except (PauseChangeConflict, InvalidTokenStateException, PermissionDenied):
        return pause_changes.refuse_unsigned(change)


def _claim(change):
    claim = outgoing.open_operation(
        pause_changes.operation_key(change),
        **{field: change.intent[field] for field in ("chain_id", "sender", "to", "data")},
        value=int(change.intent["value"]),
        restart_of=UUID(int=0),
    )
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        current = PauseChange.objects.select_for_update().get(pk=change.pk)
        if operation.claim_id != claim.claim_id or current.operation_id not in (None, operation.pk):
            raise PauseChangeConflict("A different outgoing operation owns this pause request.")
        if current.operation_id is None:
            if current.status != PauseChangeStatus.EXECUTING:
                raise PauseChangeConflict("This pause submission no longer admits signing.")
            current.operation = operation
            current.save(update_fields=["operation", "updated_at"])
    return claim


def _record_signed(change_id, attempt):
    current = PauseChange.objects.select_for_update().get(pk=change_id)
    if current.status != PauseChangeStatus.EXECUTING or current.operation_id != attempt.operation_id:
        raise PauseChangeConflict("This pause submission no longer permits signing.")
    pause_changes.check_authority(current)


def _verify_event(change, operation, client):
    if client.assert_expected_chain() != change.chain_id:
        raise PauseChangeConflict("The pause receipt provider is on a different chain.")
    receipt = client.get_transaction_receipt(operation.current_attempt.tx_hash)
    if receipt is None:
        return False
    if (
        Web3.to_hex(HexBytes(receipt["transactionHash"])) != operation.current_attempt.tx_hash
        or not isinstance(receipt.get("from"), str)
        or receipt["from"].lower() != change.intent["sender"]
        or not isinstance(receipt.get("to"), str)
        or receipt["to"].lower() != change.contract_address
        or type(receipt["status"]) is not int
        or receipt["status"] != 1
        or receipt["blockNumber"] != operation.block_number
        or Web3.to_hex(HexBytes(receipt["blockHash"])) != operation.block_hash
    ):
        raise PauseChangeConflict("The pause receipt differs from the original recorded outcome.")
    contract = client.load_contract("ShareToken", Web3.to_checksum_address(change.contract_address))
    event_type = contract.events.Paused if change.paused else contract.events.Unpaused
    matches = [
        event
        for event in event_type().process_receipt(receipt, errors=DISCARD)
        if event["address"].lower() == change.contract_address
        and event["args"]["account"].lower() == change.intent["sender"]
    ]
    if len(matches) != 1:
        raise PauseChangeConflict("The pause receipt has no unique event matching the original intent.")
    return True


def _record_outcome(change_id, claim, verified=False):
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        current = PauseChange.objects.select_for_update().get(pk=change_id)
        if operation.claim_id != claim.claim_id or current.operation_id != operation.pk:
            raise PauseChangeConflict("A different attempt owns this pause outcome.")
        if current.status == PauseChangeStatus.EXECUTING and (operation.status in FAILED or verified):
            current.status = PauseChangeStatus.CONFIRMED if verified else PauseChangeStatus.FAILED
            current.save(update_fields=["status", "updated_at"])


def _execute(change, client):
    claim = _claim(change)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in FAILED:
        _record_outcome(change.pk, claim)
        return
    client = client or get_base_chain_client()
    if operation.status == OutgoingStatus.PREPARING:
        try:
            _configuration(change, client)
            prepared = outgoing.prepare_operation(claim, client)
            _configuration(change, client)
            outgoing.sign_operation(
                claim,
                prepared,
                settings.BLOCKCHAIN_OPERATOR_KEY,
                on_signed=lambda attempt: _record_signed(change.pk, attempt),
            )
        except Exception:
            if outgoing.fail_preparing(claim):
                _record_outcome(change.pk, claim)
                return
            operation.refresh_from_db()
            if operation.claim_id != claim.claim_id or operation.status not in (
                OutgoingStatus.SIGNED,
                OutgoingStatus.CONFIRMED,
                OutgoingStatus.REVERTED,
            ):
                raise
    operation.refresh_from_db()
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
        if operation.status == OutgoingStatus.SIGNED:
            outgoing.broadcast_operation(claim, client)
            outgoing.reconcile_operation(claim, client)
    operation.refresh_from_db()
    verified = operation.status == OutgoingStatus.CONFIRMED and _verify_event(change, operation, client)
    _record_outcome(change.pk, claim, verified)


def recover(submission_id):
    pause_changes.require_autocommit()
    if current_alias() == APP_ALIAS:
        raise PauseChangeConflict("Pause recovery requires the operator connection.")
    current = PauseChange.objects.filter(pk=submission_id).first()
    if current is None or current.completed_at is not None:
        return current
    try:
        client = None
        if current.status == PauseChangeStatus.PENDING:
            client = get_base_chain_client()
            current = _decide(current, client)
        if current.status == PauseChangeStatus.EXECUTING:
            _execute(current, client)
        return pause_changes.project(current.pk)
    finally:
        PauseChange.objects.unresolved().filter(pk=submission_id).update(updated_at=timezone.now())
