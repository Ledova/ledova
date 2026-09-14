import logging
from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.db import connections
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from eth_account._utils.legacy_transactions import Transaction
from hexbytes import HexBytes
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import BlockchainTransaction
from integrations.base_chain import get_base_chain_client
from integrations.base_chain.client import BROADCAST_ROUND_TRIPS, HTTP_TIMEOUT_SECONDS
from offerings.models import Subscription, SubscriptionStatus
from shared.db import atomic, current_alias
from tokens.exceptions import (
    InvalidTokenStateException,
    IssuanceExecutionConflict,
    IssuanceExecutionUnresolved,
)
from tokens.models import (
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.services.issuance_execution import _boundary

logger = logging.getLogger(__name__)
UNNAMED_MINT_GRACE = 2 * BROADCAST_ROUND_TRIPS * timedelta(seconds=HTTP_TIMEOUT_SECONDS)
STOPPED_BEFORE_SIGNING = "The recorded unsigned mint was abandoned. Its historical evidence is retained."


def _record(request):
    if request.dispatch_id is not None:
        raise IssuanceExecutionConflict("New issuances require their admitted execution, not historical recovery.")
    issuance = ShareIssuance.objects.filter(idempotency_key=f"issuance-request:{request.pk}").first()
    if issuance is None:
        return None
    if (
        issuance.token_id != request.token_id
        or issuance.recipient_address.lower() != request.recipient_address.lower()
        or issuance.amount != str(request.amount)
        or request.executed_issuance_id not in (None, issuance.pk)
    ):
        raise IssuanceExecutionConflict("The historical issuance and request no longer identify the same mint.")
    return issuance


def unnamed_mint(request):
    if request.dispatch_id is not None:
        return None
    recorded = _record(request)
    if recorded is None or recorded.tx_hash or recorded.mint_journal is not None:
        return None
    if (recorded.processed_at or recorded.created_at) > timezone.now() - UNNAMED_MINT_GRACE:
        return None
    return recorded


def _terms(request, issuance):
    return (
        request.token_id,
        request.token.chain,
        request.token.company_id,
        request.token.contract_address.lower(),
        request.token.decimals,
        request.recipient_address.lower(),
        request.amount,
        issuance.pk,
        issuance.processed_at,
        issuance.created_at,
        issuance.token_id,
        issuance.recipient_address.lower(),
        issuance.amount,
    )


def _transaction(client, request, tx_hash):
    if client.assert_expected_chain() != settings.BLOCKCHAIN_CHAIN_ID:
        raise IssuanceExecutionUnresolved("The historical mint provider is on a different configured chain.")
    transaction = client.get_transaction(tx_hash)
    data = Web3.keccak(text="mint(address,uint256)")[:4] + encode(
        ["address", "uint256"], [Web3.to_checksum_address(request.recipient_address), request.amount]
    )
    if (
        Web3.to_hex(HexBytes(transaction.get("hash", b""))) != tx_hash
        or str(transaction.get("to", "")).lower() != request.token.contract_address.lower()
        or transaction.get("value") != 0
        or HexBytes(transaction.get("input", transaction.get("data", b""))) != data
    ):
        raise IssuanceExecutionConflict("The transaction does not match this historical mint's contract and terms.")
    return transaction


def _locked(request):
    token = ShareToken.objects.select_for_update().get(pk=request.token_id)
    subscription = Subscription.objects.select_for_update().filter(issuance_request_id=request.pk).first()
    current = ShareIssuanceRequest.objects.select_for_update().get(pk=request.pk)
    current.token = token
    issuance = ShareIssuance.objects.select_for_update().get(idempotency_key=f"issuance-request:{request.pk}")
    _record(current)
    return current, issuance, subscription


def name_the_mint(request, tx_hash):
    _boundary()
    tx_hash = Web3.to_hex(HexBytes(tx_hash))
    if len(HexBytes(tx_hash)) != 32:
        raise IssuanceExecutionConflict("The historical transaction hash must identify 32 bytes.")
    current = ShareIssuanceRequest.objects.select_related("token").get(pk=request.pk)
    recorded = _record(current)
    if recorded is None or current.status not in (RequestStatus.EXECUTING, RequestStatus.FAILED):
        raise InvalidTokenStateException("This request has no unresolved historical mint to name.")
    if recorded.tx_hash == tx_hash and recorded.mint_journal is None:
        return recorded
    if unnamed_mint(current) is None:
        raise InvalidTokenStateException("This request has no unnamed mint to attach a transaction to.")
    _transaction(get_base_chain_client(), current, tx_hash)
    with atomic(durable=True):
        locked, issuance, _ = _locked(current)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [tx_hash])
        if _terms(locked, issuance) != _terms(current, recorded):
            raise IssuanceExecutionConflict("The historical mint changed while its transaction was checked.")
        if issuance.tx_hash == tx_hash and issuance.mint_journal is None:
            return issuance
        if (
            issuance.tx_hash
            or issuance.mint_journal is not None
            or locked.status not in (RequestStatus.EXECUTING, RequestStatus.FAILED)
        ):
            raise IssuanceExecutionConflict("Another operator already resolved this historical mint association.")
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                """
                SELECT 1 FROM tokens_shareissuance
                WHERE uuid <> %s AND (lower(tx_hash) = %s OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(mint_journal) = 'array' THEN mint_journal ELSE '[]'::jsonb END
                    ) entry WHERE lower(entry->>'tx_hash') = %s
                )) LIMIT 1
                """,
                [issuance.pk, tx_hash, tx_hash],
            )
            if cursor.fetchone():
                raise IssuanceExecutionConflict("That transaction already identifies another issuance.")
        if (
            BlockchainTransaction.objects.filter(tx_hash__iexact=tx_hash)
            .exclude(related_model="tokens.ShareIssuanceRequest", related_uuid=locked.pk)
            .exists()
        ):
            raise IssuanceExecutionConflict("That transaction already identifies another operation.")
        issuance.mark_processing(tx_hash=tx_hash)
        return issuance


def _valid_journal(journal, *, current_signed=False):
    if not isinstance(journal, list) or not journal:
        return False
    identifiers = set()
    try:
        for index, entry in enumerate(journal):
            if not isinstance(entry, dict):
                return False
            if "id" in entry:
                identifier = entry["id"]
                if str(UUID(identifier)) != identifier or identifier in identifiers:
                    return False
                identifiers.add(identifier)
            if set(entry) == {"id"} or (set(entry) == {"id", "abandoned"} and entry["abandoned"] is True):
                continue
            if len(HexBytes(entry["tx_hash"])) != 32:
                return False
            if set(entry) == {"tx_hash", "reverted"} and entry["reverted"] is True:
                continue
            required = {"id", "tx_hash", "raw_transaction", "signed_at"}
            if set(entry) == required | {"reverted"} and entry["reverted"] is True:
                pass
            elif not (current_signed and index == len(journal) - 1 and set(entry) == required):
                return False
            if Web3.to_hex(Web3.keccak(HexBytes(entry["raw_transaction"]))) != entry["tx_hash"]:
                return False
        return True
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def refund_has_no_unresolved_mint(request):
    issuance = _record(request)
    if issuance is None:
        return request.status in (RequestStatus.APPROVED, RequestStatus.REJECTED)
    return (
        issuance.status != IssuanceStatus.COMPLETED and not issuance.tx_hash and _valid_journal(issuance.mint_journal)
    )


def release_unsigned_mint(request, reason=STOPPED_BEFORE_SIGNING):
    _boundary()
    if _record(request) is None:
        return False
    with atomic(durable=True):
        current, issuance, _ = _locked(request)
        journal = issuance.mint_journal
        if (
            current.status != RequestStatus.EXECUTING
            or issuance.status == IssuanceStatus.COMPLETED
            or issuance.tx_hash
            or not _valid_journal(journal)
            or set(journal[-1]) != {"id"}
        ):
            return False
        journal[-1]["abandoned"] = True
        issuance.save(update_fields=["mint_journal", "updated_at"])
        issuance.mark_failed(reason)
        current.mark_failed(reason)
    return True


def _signed_transaction(request, issuance):
    journal = issuance.mint_journal
    if journal is None:
        return None, None
    if (
        not _valid_journal(journal, current_signed=True)
        or journal[-1].get("tx_hash") != issuance.tx_hash
        or journal[-1].get("reverted")
    ):
        raise IssuanceExecutionConflict("The historical journal does not identify its current mint.")
    try:
        raw = bytes(HexBytes(journal[-1]["raw_transaction"]))
        if Web3.to_hex(Web3.keccak(raw)) != issuance.tx_hash:
            raise ValueError
        fields = Transaction.from_bytes(raw).as_dict()
        sender = Account.recover_transaction(raw)
        chain_id = (fields["v"] - 35) // 2
        data = Web3.keccak(text="mint(address,uint256)")[:4] + encode(
            ["address", "uint256"], [Web3.to_checksum_address(request.recipient_address), request.amount]
        )
        if (
            chain_id != settings.BLOCKCHAIN_CHAIN_ID
            or fields["value"] != 0
            or fields["data"] != data
            or Web3.to_hex(fields["to"]).lower() != request.token.contract_address.lower()
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError, AttributeError):
        raise IssuanceExecutionConflict("The historical signed payload does not identify this mint.") from None
    return raw, {"hash": issuance.tx_hash, "from": sender, "to": request.token.contract_address}


def _receipt(client, request, tx_hash, original=None):
    if client.assert_expected_chain() != settings.BLOCKCHAIN_CHAIN_ID:
        raise IssuanceExecutionUnresolved("The provider is on a different configured chain.")
    transaction = original or _transaction(client, request, tx_hash)
    receipt = client.get_transaction_receipt(tx_hash)
    if receipt is None:
        return None
    if (
        type(receipt.get("status")) is not int
        or receipt["status"] not in (0, 1)
        or Web3.to_hex(HexBytes(receipt.get("transactionHash", b""))) != tx_hash
        or str(receipt.get("to", "")).lower() != str(transaction["to"]).lower()
        or str(receipt.get("from", "")).lower() != str(transaction.get("from", "")).lower()
        or type(receipt.get("blockNumber")) is not int
        or len(HexBytes(receipt.get("blockHash", b""))) != 32
    ):
        raise IssuanceExecutionUnresolved("The receipt does not identify the recorded historical mint.")
    if receipt["status"] == 1:
        contract = client.load_contract("ShareToken", request.token.contract_address)
        matches = [
            event
            for event in contract.events.Transfer().process_receipt(receipt, errors=DISCARD)
            if event["address"].lower() == request.token.contract_address.lower()
            and int(event["args"]["from"], 16) == 0
            and event["args"]["to"].lower() == request.recipient_address.lower()
            and int(event["args"]["value"]) == request.amount
        ]
        if len(matches) != 1:
            raise IssuanceExecutionUnresolved("The original historical receipt has no unique matching mint event.")
    return receipt


def _projectable(request, subscription):
    if request.status not in (RequestStatus.EXECUTING, RequestStatus.FAILED, RequestStatus.EXECUTED):
        raise IssuanceExecutionConflict("This historical request no longer permits mint completion.")
    if subscription and (
        subscription.status not in (SubscriptionStatus.PAID, SubscriptionStatus.ALLOTTED)
        or (subscription.refunded_at is not None and subscription.status != SubscriptionStatus.ALLOTTED)
    ):
        raise IssuanceExecutionConflict("The historical subscription no longer permits mint completion.")


def _completed(request, issuance, subscription):
    _projectable(request, subscription)
    if request.status != RequestStatus.EXECUTED:
        request.mark_executed(issuance)
    if subscription and subscription.status == SubscriptionStatus.PAID:
        subscription.mark_allotted()
    return "executed"


def _unchanged(request, issuance, observed_request, observed_issuance):
    if (
        _terms(request, issuance) != _terms(observed_request, observed_issuance)
        or issuance.tx_hash != observed_issuance.tx_hash
        or issuance.mint_journal != observed_issuance.mint_journal
    ):
        raise IssuanceExecutionConflict("Another operation changed the historical mint association.")


def _resolve(current):
    issuance = _record(current)
    if issuance is None:
        return None
    if issuance.status == IssuanceStatus.COMPLETED:
        if not issuance.tx_hash:
            raise IssuanceExecutionConflict("The completed historical mint has no transaction identity.")
        _signed_transaction(current, issuance)
        with atomic(durable=True):
            locked, recorded, subscription = _locked(current)
            _unchanged(locked, recorded, current, issuance)
            if recorded.status != IssuanceStatus.COMPLETED:
                raise IssuanceExecutionConflict("The completed historical mint outcome has changed.")
            return _completed(locked, recorded, subscription)
    if not issuance.tx_hash:
        return "released" if release_unsigned_mint(current) else None
    client = get_base_chain_client()
    raw, original = _signed_transaction(current, issuance)
    receipt = _receipt(client, current, issuance.tx_hash, original)
    if receipt is None and raw is not None:
        try:
            answered = client.send_raw_transaction(raw)
        except Exception:
            logger.warning("Historical mint %s replay remains unresolved", issuance.pk)
        else:
            if answered != issuance.tx_hash:
                raise IssuanceExecutionUnresolved("The node returned a different hash for the historical mint.")
        receipt = _receipt(client, current, issuance.tx_hash, original)
    if receipt is None:
        return None
    with atomic(durable=True):
        locked, recorded, subscription = _locked(current)
        _unchanged(locked, recorded, current, issuance)
        _projectable(locked, subscription)
        if recorded.status == IssuanceStatus.COMPLETED:
            return _completed(locked, recorded, subscription)
        if locked.status == RequestStatus.EXECUTED:
            raise IssuanceExecutionConflict("The historical request and mint outcomes disagree.")
        if receipt["status"] == 0:
            journal = recorded.mint_journal
            if journal is None:
                recorded.mint_journal = [{"tx_hash": issuance.tx_hash, "reverted": True}]
            else:
                journal[-1]["reverted"] = True
            recorded.save(update_fields=["mint_journal", "updated_at"])
            recorded.mark_reverted(f"Transaction reverted: {issuance.tx_hash}")
            locked.mark_failed(f"Transaction reverted: {issuance.tx_hash}")
            return "reverted"
        recorded.mark_completed(
            tx_hash=issuance.tx_hash, block_number=receipt["blockNumber"], gas_used=receipt["gasUsed"]
        )
        return _completed(locked, recorded, subscription)


def resolve_executing_issuance(request):
    from tokens.services.share_token_service import seed_recipient_holding

    _boundary()
    current = ShareIssuanceRequest.objects.select_related("token").get(pk=request.pk)
    result = _resolve(current)
    if result == "executed":
        seed_recipient_holding(current.token.contract_address, current.recipient_address)
    return result
