from django.utils import timezone
from hexbytes import HexBytes
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import OutgoingOperation, OutgoingStatus
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.db import atomic
from tokens.exceptions import NAVUpdateConflict
from tokens.models import NAVUpdate, NAVUpdateMode, NAVUpdateStatus
from tokens.services import nav

FAILED = (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)


def _event(update, operation, client):
    if client.assert_expected_chain() != update.intent["chain_id"]:
        raise NAVUpdateConflict("The NAV receipt provider is on a different chain.")
    receipt = client.get_transaction_receipt(operation.current_attempt.tx_hash)
    if receipt is None:
        return None
    if (
        Web3.to_hex(HexBytes(receipt["transactionHash"])) != operation.current_attempt.tx_hash
        or not isinstance(receipt.get("from"), str)
        or receipt["from"].lower() != update.intent["sender"]
        or not isinstance(receipt.get("to"), str)
        or receipt["to"].lower() != update.intent["to"]
        or type(receipt["status"]) is not int
        or receipt["status"] != 1
        or receipt["blockNumber"] != operation.block_number
        or Web3.to_hex(HexBytes(receipt["blockHash"])) != operation.block_hash
    ):
        raise NAVUpdateConflict("The NAV receipt differs from the original recorded outcome.")
    contract = client.load_contract("AUSG", Web3.to_checksum_address(update.intent["to"]))
    matches = [
        event
        for event in contract.events.NAVUpdated().process_receipt(receipt, errors=DISCARD)
        if event["address"].lower() == update.intent["to"]
    ]
    if len(matches) != 1:
        raise NAVUpdateConflict("The original NAV receipt has no unique event matching its admitted values.")
    values = matches[0]["args"]
    if values["newNav"] != int(update.intent["nav_raw"]) or values["reserveValue"] != int(update.intent["reserve_raw"]):
        raise NAVUpdateConflict("The original NAV event differs from its admitted values.")
    if any(
        type(values[key]) is not int or not 0 <= values[key] < 2**256
        for key in ("oldNav", "newNav", "reserveValue", "timestamp")
    ):
        raise NAVUpdateConflict("The NAV event contains invalid values.")
    return {key: str(values[key]) for key in ("oldNav", "newNav", "reserveValue", "timestamp")}


def _record_outcome(update_id, claim, event=None):
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        current, _ = nav.locked_update(update_id)
        if operation.claim_id != claim.claim_id or current.operation_id != operation.pk:
            raise NAVUpdateConflict("A different attempt owns this NAV outcome.")
        if current.status == NAVUpdateStatus.EXECUTING and (operation.status in FAILED or event is not None):
            current.status = NAVUpdateStatus.CONFIRMED if event is not None else NAVUpdateStatus.FAILED
            current.event = event
            current.save(update_fields=["status", "event", "updated_at"])


def _execute(update):
    claim = outgoing.recovery_claim(update.operation_id, update.intent)
    if claim is None:
        return
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in FAILED:
        _record_outcome(update.pk, claim)
        return
    client = get_base_chain_client()
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.reconcile_operation(claim, client)
        operation.refresh_from_db()
    event = _event(update, operation, client) if operation.status == OutgoingStatus.CONFIRMED else None
    _record_outcome(update.pk, claim, event)


def recover(submission_id):
    nav.require_boundary()
    current = NAVUpdate.objects.filter(pk=submission_id).first()
    if (
        current is None
        or current.completed_at is not None
        or current.mode != NAVUpdateMode.CHAIN
        or current.status != NAVUpdateStatus.EXECUTING
        or outgoing.recovery_claim(current.operation_id, current.intent) is None
    ):
        return current
    try:
        _execute(current)
        return nav.project(current.pk)
    finally:
        NAVUpdate.objects.unresolved().filter(pk=submission_id).update(updated_at=timezone.now())
