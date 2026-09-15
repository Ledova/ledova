from uuid import UUID

from django.conf import settings
from django.utils import timezone
from hexbytes import HexBytes
from rest_framework.exceptions import PermissionDenied
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


def _claim(update):
    intent = nav.transaction_intent(update)
    claim = outgoing.open_operation(
        nav.operation_key(update), **(intent | {"value": int(intent["value"])}), restart_of=UUID(int=0)
    )
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        current, _ = nav.locked_update(update.pk)
        if operation.claim_id != claim.claim_id or current.operation_id not in (None, operation.pk):
            raise NAVUpdateConflict("A different outgoing operation owns this NAV submission.")
        if current.operation_id is None:
            if current.status != NAVUpdateStatus.EXECUTING:
                raise NAVUpdateConflict("The NAV submission no longer admits signing.")
            current.operation = operation
            current.save(update_fields=["operation", "updated_at"])
    return claim


def _configuration(update, client):
    with atomic(durable=True):
        current, _ = nav.locked_update(update.pk, authorize=True)
        if current.status != NAVUpdateStatus.EXECUTING:
            raise NAVUpdateConflict("The NAV submission no longer admits signing.")
    if client.assert_expected_chain() != update.intent["chain_id"]:
        raise NAVUpdateConflict("The NAV provider is on a different chain.")
    contract = client.load_contract("AUSG", Web3.to_checksum_address(update.intent["to"]))
    decimals = contract.functions.decimals().call()
    if type(decimals) is not int or decimals != update.intent["decimals"]:
        raise NAVUpdateConflict("The original contract units differ from the admitted NAV units.")
    authorized = contract.functions.navUpdaters(Web3.to_checksum_address(update.intent["sender"])).call()
    if authorized is not True:
        raise NAVUpdateConflict("The original signer is not an authorized NAV updater.")


def _record_signed(update_id, attempt):
    current, _ = nav.locked_update(update_id, authorize=True)
    if current.status != NAVUpdateStatus.EXECUTING or current.operation_id != attempt.operation_id:
        raise NAVUpdateConflict("The NAV submission no longer permits signing.")


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
    claim = _claim(update)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in FAILED:
        _record_outcome(update.pk, claim)
        return
    client = get_base_chain_client()
    if operation.status == OutgoingStatus.PREPARING:
        try:
            _configuration(update, client)
            prepared = outgoing.prepare_operation(claim, client)
            _configuration(update, client)
            outgoing.sign_operation(
                claim,
                prepared,
                settings.BLOCKCHAIN_OPERATOR_KEY,
                on_signed=lambda attempt: _record_signed(update.pk, attempt),
            )
        except Exception:
            if outgoing.fail_preparing(claim):
                _record_outcome(update.pk, claim)
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
    event = _event(update, operation, client) if operation.status == OutgoingStatus.CONFIRMED else None
    _record_outcome(update.pk, claim, event)


def recover(submission_id):
    nav.require_boundary()
    current = NAVUpdate.objects.filter(pk=submission_id).first()
    if current is None or current.completed_at is not None or current.mode != NAVUpdateMode.CHAIN:
        return current
    try:
        if current.status == NAVUpdateStatus.QUEUED:
            try:
                current = nav.decide(current.pk)
            except (NAVUpdateConflict, PermissionDenied):
                return nav.refuse_unsigned(current.pk)
        if current.status == NAVUpdateStatus.EXECUTING:
            _execute(current)
        return nav.project(current.pk)
    finally:
        NAVUpdate.objects.unresolved().filter(pk=submission_id).update(updated_at=timezone.now())
