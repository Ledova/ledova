import logging
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
from operators.settlement import require_deployment, settlement_assets
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.exceptions import MintRequestConflict, MintRequestUnresolved
from tokens.models import MintRequest, MintRequestStatus
from tokens.services.stablecoin_service import StablecoinService

logger = logging.getLogger(__name__)
INTENT_FIELDS = ("chain_id", "sender", "to", "value", "data")
REQUEST_FIELDS = ("recipient_address", "recipient_name", "amount", "deposit_reference", "deposit_date")


def _boundary():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Mint execution requires operator authority.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise MintRequestConflict("Mint execution requires autocommit outside every transaction block.")


def _authorize(user, permission):
    actor = get_user_model().objects.get(pk=user.pk)
    if not actor.is_active or not actor.is_staff or not actor.has_perm(permission):
        raise PermissionDenied("You cannot execute this mint request.")
    return actor


def asset_service(asset) -> StablecoinService:
    return StablecoinService(contract_address=require_deployment(asset).contract_address)


def create_request(submission_id, user, *, settlement_asset=None, yield_token=None, **terms):
    _boundary()
    if (settlement_asset is None) == (yield_token is None):
        raise MintRequestConflict("A mint must name exactly one token.")
    permission = "assets.change_asset" if settlement_asset is not None else "tokens.change_yieldtoken"
    actor = _authorize(user, permission)
    expected = {field: terms[field] for field in REQUEST_FIELDS}
    expected |= {"settlement_asset": settlement_asset, "yield_token": yield_token, "requested_by": actor}
    with atomic(durable=True):
        request, _ = MintRequest.objects.get_or_create(
            pk=UUID(str(submission_id)), defaults=expected | {"notes": terms.get("notes", "")}
        )
        if request.dispatch_id is None or any(getattr(request, field) != value for field, value in expected.items()):
            raise MintRequestConflict("This mint submission already identifies different terms or historical work.")
        return request


def _intent(request):
    if (
        type(request.amount) is not int
        or not 0 < request.amount < 2**63
        or not Web3.is_address(request.recipient_address)
    ):
        raise MintRequestConflict("The mint amount or recipient is invalid.")
    if request.settlement_asset_id:
        if not settlement_assets().filter(pk=request.settlement_asset_id).exists():
            raise MintRequestConflict("The settlement asset is no longer eligible for minting.")
        deployment = require_deployment(request.settlement_asset)
        if deployment.chain != "base":
            raise MintRequestConflict("This mint requires a Base-chain deployment.")
        target = deployment.contract_address
        identity = {
            "token_id": str(request.settlement_asset_id),
            "deployment_id": str(deployment.pk),
            "decimals": deployment.decimals,
            "contract_name": "AUDY",
            "tx_type": TransactionType.STABLECOIN_MINT,
        }
    else:
        token = request.yield_token
        if token is None or not token.is_active:
            raise MintRequestConflict("The yield token is no longer active.")
        target = token.contract_address
        identity = {
            "token_id": str(token.pk),
            "deployment_id": None,
            "decimals": token.decimals,
            "contract_name": "AUSG",
            "tx_type": TransactionType.YIELD_TOKEN_MINT,
        }
    try:
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        data = Web3.keccak(text="mint(address,uint256)")[:4] + encode(
            ["address", "uint256"], [request.recipient_address, request.amount]
        )
        intent = outgoing.transaction_intent(chain_id=settings.BLOCKCHAIN_CHAIN_ID, sender=sender, to=target, data=data)
    except (ValueError, TypeError):
        raise MintRequestConflict("The mint signing identity or deployment is not configured.") from None
    return intent | identity | {"recipient": request.recipient_address.lower(), "amount": str(request.amount)}


def _admit(request_id, user, permission, notes):
    with atomic(durable=True):
        request = MintRequest.objects.select_for_update().get(pk=request_id)
        if (permission == "assets.change_asset" and request.settlement_asset_id is None) or (
            permission == "tokens.change_yieldtoken" and request.yield_token_id is None
        ):
            raise PermissionDenied("The mint entry point names a different token type.")
        actor = _authorize(user, permission)
        if request.dispatch_id is None:
            raise MintRequestConflict("This historical mint requires operator attribution before it can be recovered.")
        if request.status == MintRequestStatus.REJECTED:
            raise MintRequestConflict("This mint request was rejected.")
        if request.execution_intent is None:
            if request.status not in (MintRequestStatus.PENDING, MintRequestStatus.APPROVED):
                raise MintRequestConflict("This mint has no attributable execution intent.")
            request.execution_intent = _intent(request)
            request.executed_by = actor
            request.status = MintRequestStatus.EXECUTING
            request.save(update_fields=["execution_intent", "executed_by", "status", "updated_at"])
        entry = f"Execution notes: {notes}"
        if notes and entry not in request.notes:
            request.notes = f"{request.notes}\n\n{entry}".strip()
            request.save(update_fields=["notes", "updated_at"])
        return request


def _key(request):
    return f"mint-request:{request.pk}:{request.dispatch_id}"


def _claim(request, *, retry_of):
    if request.operation_id is not None:
        operation = OutgoingOperation.objects.get(pk=request.operation_id)
        if retry_of is None or operation.status not in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
            return outgoing.OperationClaim(operation.pk, operation.claim_id)
    intent = {field: request.execution_intent[field] for field in INTENT_FIELDS}
    intent["value"] = int(intent["value"])
    claim = outgoing.open_operation(_key(request), **intent, restart_of=retry_of or UUID(int=0))
    with atomic(durable=True):
        current = MintRequest.objects.select_for_update().get(pk=request.pk)
        if current.execution_intent != request.execution_intent or current.operation_id not in (
            None,
            claim.operation_id,
        ):
            raise MintRequestConflict("The mint operation association changed.")
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        if operation.claim_id != claim.claim_id:
            raise MintRequestConflict("A newer mint attempt owns this outcome.")
        current.operation_id = claim.operation_id
        if current.status == MintRequestStatus.FAILED and operation.status not in (
            OutgoingStatus.FAILED,
            OutgoingStatus.REVERTED,
        ):
            current.status = MintRequestStatus.EXECUTING
        current.save(update_fields=["operation", "status", "updated_at"])
    return claim


def _check_preparation(request_id, intent, client):
    current = MintRequest.objects.get(pk=request_id)
    if _intent(current) != intent:
        raise MintRequestConflict("The mint deployment or signing configuration changed after admission.")
    if client.assert_expected_chain() != intent["chain_id"]:
        raise MintRequestConflict("The mint provider is on a different chain.")
    contract = client.load_contract(intent["contract_name"], Web3.to_checksum_address(intent["to"]))
    if not contract.functions.minters(Web3.to_checksum_address(intent["sender"])).call():
        raise MintRequestConflict("The recorded signer is not an authorized minter.")


def _project(request_id, claim):
    with atomic(durable=True):
        request = MintRequest.objects.select_for_update().get(pk=request_id)
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        if request.operation_id != operation.pk or operation.claim_id != claim.claim_id:
            raise MintRequestConflict("A newer mint attempt owns this outcome.")
        attempt = operation.current_attempt
        record = None
        if attempt is not None:
            expected = {
                "tx_type": request.execution_intent["tx_type"],
                "from_address": operation.intent["sender"],
                "to_address": operation.intent["to"],
                "function_name": "mint",
                "function_args": {
                    "to": request.execution_intent["recipient"],
                    "amount": int(request.execution_intent["amount"]),
                },
                "related_model": "tokens.MintRequest",
                "related_uuid": request.pk,
            }
            record, _ = BlockchainTransaction.objects.get_or_create(tx_hash=attempt.tx_hash, defaults=expected)
            if any(getattr(record, field) != value for field, value in expected.items()):
                raise MintRequestConflict("The mint transaction hash belongs to different recorded work.")
            record = BlockchainTransaction.objects.select_for_update().get(pk=record.pk)
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
            request.transaction = record
        request.status = {
            OutgoingStatus.PREPARING: MintRequestStatus.EXECUTING,
            OutgoingStatus.SIGNED: MintRequestStatus.EXECUTING,
            OutgoingStatus.CONFIRMED: MintRequestStatus.EXECUTED,
            OutgoingStatus.REVERTED: MintRequestStatus.FAILED,
            OutgoingStatus.FAILED: MintRequestStatus.FAILED,
        }[operation.status]
        request.error_message = {
            OutgoingStatus.FAILED: "The mint stopped before signing. An operator may retry the recorded intent.",
            OutgoingStatus.REVERTED: "The recorded mint reverted on chain. An operator may retry the recorded intent.",
        }.get(operation.status, "")
        if request.status == MintRequestStatus.EXECUTED:
            request.executed_at = request.executed_at or timezone.now()
        request.save(update_fields=["status", "transaction", "error_message", "executed_at", "updated_at"])
        return request


def _process(request, *, retry_of=None):
    claim = _claim(request, retry_of=retry_of)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED, OutgoingStatus.FAILED):
        return _project(request.pk, claim)
    client = get_base_chain_client()
    if operation.status == OutgoingStatus.PREPARING:
        try:
            _check_preparation(request.pk, request.execution_intent, client)
            prepared = outgoing.prepare_operation(claim, client)
            _check_preparation(request.pk, request.execution_intent, client)
        except Exception:
            stopped = outgoing.fail_preparing(claim)
            current = _project(request.pk, claim)
            if not stopped:
                return current
            raise MintRequestUnresolved(
                "The mint could not be prepared. Its recorded state is available for recovery."
            ) from None
        outgoing.sign_operation(claim, prepared, settings.BLOCKCHAIN_OPERATOR_KEY)
    request = _project(request.pk, claim)
    if request.status != MintRequestStatus.EXECUTING:
        return request
    outgoing.reconcile_operation(claim, client)
    operation.refresh_from_db()
    if operation.status == OutgoingStatus.SIGNED:
        outgoing.broadcast_operation(claim, client)
        outgoing.reconcile_operation(claim, client)
    return _project(request.pk, claim)


def execute(mint_request, user, notes="", *, permission="tokens.change_mintrequest", retry_of=None):
    _boundary()
    allowed = {"tokens.change_mintrequest", "assets.change_asset", "tokens.change_yieldtoken"}
    if permission not in allowed:
        raise PermissionDenied("The mint entry point is not authorized.")
    request = _admit(mint_request.pk, user, permission, notes)
    try:
        current = _process(request, retry_of=retry_of)
    except (MintRequestConflict, MintRequestUnresolved, PermissionDenied):
        raise
    except Exception:
        logger.exception("Mint request %s requires outcome recovery", request.pk)
        raise MintRequestUnresolved() from None
    mint_request.refresh_from_db()
    if current.status == MintRequestStatus.FAILED:
        raise MintRequestConflict(current.error_message)
    return (current.transaction.tx_hash if current.transaction_id else ""), current.transaction


def recover(request_id):
    _boundary()
    request = MintRequest.objects.filter(pk=request_id, execution_intent__isnull=False).first()
    if request is None or request.dispatch_id is None or request.status == MintRequestStatus.REJECTED:
        return "not_admitted"
    try:
        return _process(request).status
    except Exception:
        logger.exception("Mint request %s remains unresolved", request.pk)
        MintRequest.objects.filter(pk=request.pk).update(updated_at=timezone.now())
        return "unresolved"


def reject(mint_request, user, reason):
    _boundary()
    actor = _authorize(user, "tokens.change_mintrequest")
    with atomic(durable=True):
        request = MintRequest.objects.select_for_update().get(pk=mint_request.pk)
        if not request.can_be_rejected:
            raise MintRequestConflict("An admitted or completed mint cannot be rejected.")
        request.status = MintRequestStatus.REJECTED
        request.executed_by = actor
        request.executed_at = timezone.now()
        request.rejection_reason = reason
        request.save(update_fields=["status", "executed_by", "executed_at", "rejection_reason", "updated_at"])
        return request
