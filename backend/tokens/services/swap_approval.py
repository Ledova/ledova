from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from hexbytes import HexBytes
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import OutgoingOperation, OutgoingStatus, TransactionStatus
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.db import atomic
from shared.registry_scope import refuse_deferred_execution
from shared.tasks.queue import defer
from tokens.exceptions import InvalidTokenStateException
from tokens.models import SwapApprovalOutcome, TokenDeployment
from tokens.services.deployment_journal import caller_principal

RETRY_SALT = "tokens.swap_approval.retry"
ACTIVE = (SwapApprovalOutcome.PENDING, SwapApprovalOutcome.EXECUTING)
FAILED = (OutgoingStatus.FAILED, OutgoingStatus.REVERTED)


def approval_intent(deployment):
    if not Web3.is_address(settings.ATOMIC_SWAP_ADDRESS):
        return None
    target = Web3.to_checksum_address(settings.ATOMIC_SWAP_ADDRESS)
    if target.lower() == "0x" + "0" * 40:
        return None
    token = Web3.to_checksum_address(deployment.contract_address)
    data = Web3.keccak(text="setShareTokenApproval(address,bool)")[:4] + encode(["address", "bool"], [token, True])
    return outgoing.transaction_intent(
        chain_id=deployment.intent["chain_id"],
        sender=deployment.intent["sender"],
        to=target,
        data=data,
    ) | {"token": token.lower()}


def _operator():
    if caller_principal() is not None:
        raise InvalidTokenStateException("Swap approval recovery requires an operator connection.")


def _key(deployment):
    return f"swap-approval:{deployment.pk}"


def _check_configuration(deployment, client):
    intent = deployment.approval_intent
    if (
        settings.BLOCKCHAIN_CHAIN_ID != intent["chain_id"]
        or Web3.to_checksum_address(settings.ATOMIC_SWAP_ADDRESS).lower() != intent["to"]
        or Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower() != intent["sender"]
        or client.assert_expected_chain() != intent["chain_id"]
    ):
        raise InvalidTokenStateException("The configured approval chain, contract or signer changed after admission.")


def _verify_event(deployment, operation, client):
    if client.assert_expected_chain() != deployment.approval_intent["chain_id"]:
        raise InvalidTokenStateException("The approval receipt provider is on a different chain.")
    receipt = client.get_transaction_receipt(operation.current_attempt.tx_hash)
    if receipt is None:
        return False
    if (
        Web3.to_hex(HexBytes(receipt["transactionHash"])) != operation.current_attempt.tx_hash
        or not isinstance(receipt.get("from"), str)
        or receipt["from"].lower() != deployment.approval_intent["sender"]
        or not isinstance(receipt.get("to"), str)
        or receipt["to"].lower() != deployment.approval_intent["to"]
        or type(receipt["status"]) is not int
        or receipt["status"] != 1
        or receipt["blockNumber"] != operation.block_number
        or Web3.to_hex(HexBytes(receipt["blockHash"])) != operation.block_hash
    ):
        raise InvalidTokenStateException("The approval receipt differs from the recorded outcome.")
    intent = deployment.approval_intent
    contract = client.load_contract("AtomicSwap", Web3.to_checksum_address(intent["to"]))
    events = contract.events.ShareTokenApproved().process_receipt(receipt, errors=DISCARD)
    matches = [
        event
        for event in events
        if event["address"].lower() == intent["to"]
        and event["args"]["token"].lower() == intent["token"]
        and event["args"]["approved"] is True
    ]
    if len(matches) != 1:
        raise InvalidTokenStateException("The approval receipt has no unique event matching the original intent.")
    return True


def _record_outcome(deployment_id, claim, *, verified=False):
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        current = TokenDeployment.objects.select_for_update().get(pk=deployment_id)
        if operation.claim_id != claim.claim_id or current.approval_operation_id != operation.pk:
            raise InvalidTokenStateException("A newer approval attempt owns this outcome.")
        if current.approval_outcome != SwapApprovalOutcome.EXECUTING or current.approval_retry_of == claim.claim_id:
            return current.approval_outcome
        if operation.status == OutgoingStatus.CONFIRMED and not verified:
            return current.approval_outcome
        if operation.status in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
            record = current.approval_transaction
            if record is None or record.tx_hash != operation.current_attempt.tx_hash:
                raise InvalidTokenStateException("The approval lost its original transaction association.")
            record.block_number = operation.block_number
            record.block_hash = operation.block_hash
            record.gas_used = operation.gas_used
            record.confirmed_at = timezone.now()
            record.status = TransactionStatus.CONFIRMED if verified else TransactionStatus.REVERTED
            record.error_message = "" if verified else "The recorded swap approval reverted on chain."
            record.save(
                update_fields=[
                    "block_number",
                    "block_hash",
                    "gas_used",
                    "confirmed_at",
                    "status",
                    "error_message",
                    "updated_at",
                ]
            )
        if operation.status in FAILED or verified:
            current.approval_outcome = SwapApprovalOutcome.CONFIRMED if verified else SwapApprovalOutcome.FAILED
            current.save(update_fields=["approval_outcome", "updated_at"])
        return current.approval_outcome


def recover(deployment_id):
    _operator()
    current = TokenDeployment.objects.filter(pk=deployment_id).first()
    if current is None or current.approval_outcome not in ACTIVE:
        return current.approval_outcome if current else None
    claim = outgoing.recovery_claim(current.approval_operation_id, current.approval_intent)
    if claim is None:
        return current.approval_outcome
    try:
        operation = OutgoingOperation.objects.get(pk=claim.operation_id)
        if operation.status in FAILED:
            return _record_outcome(current.pk, claim)
        client = get_base_chain_client()
        if operation.status == OutgoingStatus.SIGNED:
            outgoing.reconcile_operation(claim, client)
            operation.refresh_from_db()
        verified = operation.status == OutgoingStatus.CONFIRMED and _verify_event(current, operation, client)
        return _record_outcome(current.pk, claim, verified=verified)
    finally:
        TokenDeployment.objects.filter(pk=deployment_id, approval_outcome__in=ACTIVE).update(updated_at=timezone.now())


def _current_actor(user):
    actor = get_user_model().objects.filter(pk=getattr(user, "pk", None)).first()
    if actor is None or not actor.is_active or not actor.is_staff or not actor.has_perm("tokens.change_sharetoken"):
        raise InvalidTokenStateException("Swap approval retry requires staff permission to change the token.")
    return actor


def retry_confirmation(token, actor):
    _operator()
    actor = _current_actor(actor)
    current = (
        TokenDeployment.objects.filter(pk=token.deployment_id, token_id=token.pk)
        .select_related("approval_operation")
        .first()
    )
    if current is None or current.approval_outcome != SwapApprovalOutcome.FAILED:
        raise InvalidTokenStateException("Only a completed failed approval permits a new attempt.")
    return signing.dumps(
        {
            "actor": actor.pk,
            "token": str(token.pk),
            "deployment": str(current.pk),
            "claim": str(current.approval_operation.claim_id),
        },
        salt=RETRY_SALT,
    )


def retry(token, actor, confirmation):
    refuse_deferred_execution()
    from tokens.tasks.deployment import recover_swap_approval

    _operator()
    actor = _current_actor(actor)
    try:
        confirmed = signing.loads(confirmation, salt=RETRY_SALT)
        claim_id = UUID(confirmed["claim"])
    except (signing.BadSignature, TypeError, ValueError, KeyError):
        raise InvalidTokenStateException("Reload the swap approval retry confirmation.") from None
    if (
        confirmed["actor"] != actor.pk
        or confirmed["token"] != str(token.pk)
        or confirmed["deployment"] != str(token.deployment_id)
    ):
        raise InvalidTokenStateException("The confirmation identifies a different actor or deployment.")
    with atomic(durable=True):
        operation = (
            OutgoingOperation.objects.select_for_update()
            .filter(operation_key=f"swap-approval:{token.deployment_id}")
            .first()
        )
        current = TokenDeployment.objects.select_for_update().filter(pk=token.deployment_id, token_id=token.pk).first()
        if current and current.approval_retry_of == claim_id:
            return current.approval_outcome
        if (
            operation is None
            or current is None
            or current.approval_operation_id != operation.pk
            or current.approval_outcome != SwapApprovalOutcome.FAILED
            or operation.claim_id != claim_id
            or operation.status not in FAILED
        ):
            raise InvalidTokenStateException("A newer approval attempt owns this outcome; reload the confirmation.")
        if operation.status == OutgoingStatus.REVERTED and (
            current.approval_transaction is None
            or current.approval_transaction.status != TransactionStatus.REVERTED
            or current.approval_transaction.block_hash != operation.block_hash
        ):
            raise InvalidTokenStateException("The previous approval receipt must be retained before retry.")
        current.approval_retry_of = claim_id
        current.approval_outcome = SwapApprovalOutcome.EXECUTING
        current.save(update_fields=["approval_retry_of", "approval_outcome", "updated_at"])
        defer(recover_swap_approval, deployment_id=str(current.pk))
