from django.utils import timezone
from hexbytes import HexBytes
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import OutgoingOperation, OutgoingStatus
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, current_alias
from tokens.exceptions import PauseChangeConflict
from tokens.models import PauseChange, PauseChangeStatus
from tokens.services import pause_changes

FAILED = (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)


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
    initial = PauseChange.objects.get(pk=change_id)
    with pause_changes.target_transaction(initial.chain_id, initial.contract_address):
        current = pause_changes.lock_original(change_id)
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        if operation.claim_id != claim.claim_id or current.operation_id != operation.pk:
            raise PauseChangeConflict("A different attempt owns this pause outcome.")
        if current.status == PauseChangeStatus.EXECUTING and (operation.status in FAILED or verified):
            current.status = PauseChangeStatus.CONFIRMED if verified else PauseChangeStatus.FAILED
            current.save(update_fields=["status", "updated_at"])


def _execute(change, client):
    claim = outgoing.recovery_claim(change.operation_id, change.intent)
    if claim is None:
        return
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in FAILED:
        _record_outcome(change.pk, claim)
        return
    client = client or get_base_chain_client()
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
    verified = operation.status == OutgoingStatus.CONFIRMED and _verify_event(change, operation, client)
    _record_outcome(change.pk, claim, verified)


def recover(submission_id):
    pause_changes.require_autocommit()
    if current_alias() == APP_ALIAS:
        raise PauseChangeConflict("Pause recovery requires the operator connection.")
    current = PauseChange.objects.filter(pk=submission_id).first()
    if (
        current is None
        or current.completed_at is not None
        or current.status != PauseChangeStatus.EXECUTING
        or outgoing.recovery_claim(current.operation_id, current.intent) is None
    ):
        return current
    try:
        _execute(current, None)
        return pause_changes.project(current.pk)
    finally:
        PauseChange.objects.unresolved().filter(pk=submission_id).update(updated_at=timezone.now())
