import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Optional

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from web3 import Web3

from assets.models import Asset, AssetType
from assets.services.identity import free_symbol, verified_contract_asset
from blockchain.models import BlockchainTransaction
from integrations.base_chain import get_base_chain_client
from integrations.base_chain.client import BROADCAST_ROUND_TRIPS, HTTP_TIMEOUT_SECONDS
from integrations.base_chain.exceptions import (
    BaseChainConnectionError,
    BaseChainContractError,
    BaseChainTransactionError,
)
from operators.settlement import settlement_deployments
from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic
from tokens.exceptions import (
    ContractLoadException,
    DeployedShareClassException,
    InvalidHolderAddressException,
    InvalidRecipientAddressException,
    InvalidTokenAddressException,
    InvalidTokenStateException,
    IssuanceRefusedException,
    OperatorKeyNotConfiguredException,
    TokenBalanceRetrievalException,
    TokenFactoryNotConfiguredException,
    TokenPauseFailedException,
    WalletBalancesUnavailableException,
)
from tokens.models import (
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
    ShareTokenStatus,
)
from tokens.querysets.share_issuance import ISSUANCE_KEY_PREFIX
from tokens.services.dilution import dilution_for
from tokens.services.holder_identity import identity_at_allotment
from tokens.services.mint_journal import (
    fail_mint_attempt,
    fail_recorded_mint,
    mark_mint_reverted,
    mint_failure_detail,
    record_signed_mint,
    recorded_mint_payload,
    release_unsigned_mint,
    start_mint_attempt,
)

logger = logging.getLogger(__name__)

LOG_WINDOW = 2000

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
NOT_WHITELISTED = "Recipient wallet is not whitelisted. Whitelist it before executing."
EXCEEDS_AUTHORIZED = "Amount exceeds authorized shares. Submit a capital increase first."
UNNAMED_MINT_GRACE = 2 * BROADCAST_ROUND_TRIPS * timedelta(seconds=HTTP_TIMEOUT_SECONDS)
CLAIMED_BEFORE_RECORDED = (
    "The worker claimed this request and stopped before recording a mint, so nothing was sent. "
    "Retrying issues afresh."
)
STOPPED_BEFORE_SIGNING = "The worker stopped before recording a signed mint. Its attempt was closed; retrying is safe."
TOKEN_PAUSED = "Token is paused. Unpause it before executing."
SHARE_ASSET_CHAIN = BLOCKCHAIN_BASE
NOT_ATTESTED = "{symbol} at {address} is not the address the factory holds for {identifier}; left unverified"
ISSUANCE_EXECUTION_FAILED = (
    "The share issuance could not be confirmed. An operator must check the request's transaction history "
    "and on-chain state before deciding whether to retry."
)


def factory_address() -> str:
    address = getattr(settings, "SHARE_TOKEN_FACTORY_ADDRESS", "")
    if not address:
        raise TokenFactoryNotConfiguredException(
            "SHARE_TOKEN_FACTORY_ADDRESS not configured. "
            "Please deploy the ShareTokenFactory contract and set the address."
        )
    return address


def signer_key() -> str:
    key = getattr(settings, "BLOCKCHAIN_OPERATOR_KEY", "")
    if not key:
        raise OperatorKeyNotConfiguredException()
    return key


def factory_contract():
    try:
        return get_base_chain_client().load_contract("ShareTokenFactory", factory_address())
    except BaseChainContractError as exc:
        logger.error("ShareTokenFactory could not be loaded: %s", exc)
        raise ContractLoadException("The token factory contract could not be loaded.") from exc


def token_identifier(token: ShareToken) -> str:
    return f"{token.company.acn}:{token.symbol}"


def _validate_address(address: str) -> str:
    if not get_base_chain_client().is_valid_address(address):
        raise InvalidRecipientAddressException()
    return get_base_chain_client().to_checksum_address(address)


def _tx_result(tx_hash: str, receipt: dict | None) -> dict:
    return {
        "tx_hash": tx_hash,
        "block_number": receipt["blockNumber"] if receipt else None,
        "gas_used": receipt["gasUsed"] if receipt else None,
    }


def _mint_to(
    contract_address: str,
    recipient: str,
    amount: int,
    on_signed: Callable[[str, bytes], None],
) -> dict:
    token_contract = load_share_token(contract_address)
    recipient_checksum = get_base_chain_client().to_checksum_address(recipient)

    mint_fn = token_contract.functions.mint(recipient_checksum, amount)
    tx_hash, _ = get_base_chain_client().send_transaction(
        mint_fn, signer_key(), wait_for_receipt=False, on_signed=on_signed
    )
    receipt = get_base_chain_client().wait_for_receipt(tx_hash)

    return _tx_result(tx_hash, receipt)


def _get_balance(contract_name: str, contract_address: str, holder: str) -> int:
    if not get_base_chain_client().is_valid_address(holder):
        raise InvalidHolderAddressException()

    contract = get_base_chain_client().load_contract(
        contract_name, get_base_chain_client().to_checksum_address(contract_address)
    )
    holder_checksum = get_base_chain_client().to_checksum_address(holder)

    return contract.functions.balanceOf(holder_checksum).call()


def load_share_token(contract_address: str):
    if not get_base_chain_client().is_valid_address(contract_address):
        raise InvalidTokenAddressException()

    checksum = get_base_chain_client().to_checksum_address(contract_address)
    return get_base_chain_client().load_contract("ShareToken", checksum)


def _confirm_record(tx_record: BlockchainTransaction, receipt) -> None:
    tx_record.mark_confirmed(
        block_number=receipt["blockNumber"],
        block_hash=Web3.to_hex(receipt["blockHash"]),
        gas_used=receipt["gasUsed"],
    )


def bridge_share_asset(token: ShareToken, contract_address: str) -> bool:
    identifier = token_identifier(token)
    try:
        attested = get_token_by_identifier(identifier)
    except Exception as exc:
        logger.warning(f"getTokenByIdentifier({identifier}) failed; {token.symbol} has no verified asset: {exc}")
        return False
    if not attested or attested.lower() != contract_address.lower():
        logger.warning(NOT_ATTESTED.format(symbol=token.symbol, address=contract_address, identifier=identifier))
        return False
    try:
        asset = verified_contract_asset(
            chain=SHARE_ASSET_CHAIN,
            contract_address=contract_address,
            symbol=_share_asset_symbol(token, contract_address),
            name=f"{token.company.name} {token.name}",
            decimals=token.decimals,
            asset_type=AssetType.TOKENIZED_SECURITY.value,
        )
    except Exception as exc:
        logger.error(f"Could not bridge {token.symbol} at {contract_address} into an asset: {exc}")
        return False
    logger.info(f"{token.symbol} at {contract_address} is asset {asset.symbol} on {SHARE_ASSET_CHAIN}")
    return True


def _share_asset_symbol(token: ShareToken, contract_address: str) -> str:
    bare = token.symbol
    if free_symbol(bare, contract_address) == bare:
        return bare
    return f"{bare}.{token.company.acn}" if token.company.acn else bare


def _approve_for_swap(token: ShareToken) -> None:
    from tokens.services import AtomicSwapService

    try:
        approval_tx = AtomicSwapService().approve_share_token(token.contract_address)
        if approval_tx:
            logger.info(f"Approved {token.symbol} for AtomicSwap: {approval_tx}")
    except Exception as exc:
        logger.warning(f"Could not approve {token.symbol} for AtomicSwap: {exc}")


def get_token_by_identifier(identifier: str) -> Optional[str]:
    address = factory_contract().functions.getTokenByIdentifier(identifier).call()
    return None if address == ZERO_ADDRESS else address


def create_issuance_request(
    token, recipient: str, amount: int, user, reason: str = "", issuance_type: str = "additional"
) -> ShareIssuanceRequest:
    if token.status != "deployed":
        raise InvalidTokenStateException("Only deployed tokens can issue shares.")

    if not token.contract_address:
        raise InvalidTokenStateException("Token has no contract address.")

    if not recipient or not Web3.is_address(recipient):
        raise InvalidRecipientAddressException()

    if amount <= 0:
        raise ValidationError({"amount": "Amount must be a positive integer."})

    issuance_request = ShareIssuanceRequest.objects.create(
        token=token,
        recipient_address=recipient,
        amount=amount,
        issuance_type=issuance_type,
        reason=reason,
        submitted_by=user,
        submitted_at=timezone.now(),
    )

    issuance_request.dilution_percentage = dilution_for(issuance_request)
    issuance_request.save(update_fields=["dilution_percentage", "updated_at"])

    logger.info(
        f"User {user.pk} created issuance request {issuance_request.uuid}: " f"{amount} {token.symbol} to {recipient}"
    )

    return issuance_request


def deployment_block(tx_hash: str) -> int:
    return get_base_chain_client().w3.eth.get_transaction_receipt(tx_hash)["blockNumber"]


def head_block() -> int:
    return get_base_chain_client().w3.eth.block_number


def finalized_block() -> int:
    number = get_base_chain_client().w3.eth.get_block("finalized")["number"]
    if not isinstance(number, int) or isinstance(number, bool) or number < 0:
        raise ValueError("The provider did not return a finalized block number.")
    return number


def _transfer_logs(contract_address: str, from_block: int, to_block: int, window: int):
    if window <= 0:
        raise ValueError("Transfer-log window must be positive.")
    token_contract = load_share_token(contract_address)
    for start in range(from_block, to_block + 1, window):
        end = min(start + window - 1, to_block)
        yield from token_contract.events.Transfer().get_logs(from_block=start, to_block=end)


def transfer_entries(contract_address: str, from_block: int, to_block: int, window: int = LOG_WINDOW):
    entries = [
        {
            "from": entry["args"]["from"],
            "to": entry["args"]["to"],
            "value": int(entry["args"]["value"]),
            "block_number": int(entry["blockNumber"]),
            "log_index": int(entry["logIndex"]),
        }
        for entry in _transfer_logs(contract_address, from_block, to_block, window)
    ]
    return sorted(entries, key=lambda item: (item["block_number"], item["log_index"]))


def block_date(block_number: int):
    stamp = get_base_chain_client().w3.eth.get_block(block_number)["timestamp"]
    return datetime.fromtimestamp(int(stamp), tz=dt_timezone.utc).date()


def transfer_participants(contract_address: str, from_block: int, window: int = LOG_WINDOW) -> set:
    return {
        address
        for entry in _transfer_logs(contract_address, from_block, head_block(), window)
        for address in (entry["args"]["from"], entry["args"]["to"])
    }


def share_supply(contract_address: str) -> tuple[int, int]:
    token_contract = load_share_token(contract_address)
    return token_contract.functions.authorizedShares().call(), token_contract.functions.totalSupply().call()


def is_recipient_whitelisted(address: str) -> bool:
    from whitelist.services import whitelist

    return whitelist.is_whitelisted(address)


def execute_request(request, executed_by=None) -> dict:
    if not isinstance(request, ShareIssuanceRequest):
        raise InvalidTokenStateException("This request requires its own admitted execution.")
    token = request.token
    if not request.can_be_executed:
        raise InvalidTokenStateException(f"Cannot execute request with status '{request.get_status_display()}'")
    if not token.contract_address or token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED):
        request.mark_failed("Token is not deployed on blockchain")
        raise InvalidTokenStateException("Token is not deployed on blockchain")

    return _execute_issuance(request, executed_by)


def issuance_key(request: ShareIssuanceRequest) -> str:
    return f"{ISSUANCE_KEY_PREFIX}{request.uuid}"


def broadcast_mint(request: ShareIssuanceRequest) -> Optional[ShareIssuance]:
    return ShareIssuance.objects.broadcast().filter(idempotency_key=issuance_key(request)).first()


def _start_execution(request) -> None:
    try:
        request.mark_executing()
    except ValueError as exc:
        logger.error(f"Request {request.uuid} could not be claimed for execution: {exc}")
        raise InvalidTokenStateException(
            f"Cannot execute request with status '{request.get_status_display()}'"
        ) from exc


def _refuse_if_paused(request: ShareIssuanceRequest) -> None:
    token = request.token
    if token.status == ShareTokenStatus.PAUSED or read_paused(token):
        request.mark_refused(TOKEN_PAUSED)
        raise IssuanceRefusedException(TOKEN_PAUSED)


def _execute_issuance(request: ShareIssuanceRequest, executed_by) -> dict:
    token = request.token
    recipient = _validate_address(request.recipient_address)
    issuance = ShareIssuance.objects.filter(idempotency_key=issuance_key(request)).first()
    if issuance is not None and issuance.tx_hash:
        result = _resume_issuance(request, issuance)
        if result is not None:
            return result

    _refuse_if_paused(request)
    if not is_recipient_whitelisted(recipient):
        request.mark_refused(NOT_WHITELISTED)
        raise IssuanceRefusedException(NOT_WHITELISTED)
    authorized, issued = share_supply(token.contract_address)
    if request.amount > authorized - issued:
        request.mark_refused(EXCEEDS_AUTHORIZED)
        raise IssuanceRefusedException(EXCEEDS_AUTHORIZED)

    stamped = identity_at_allotment(recipient, chain=SHARE_ASSET_CHAIN)
    issuance, attempt_id = start_mint_attempt(
        request,
        issuance,
        token=token,
        recipient_address=recipient,
        recipient_name=stamped.name or request.recipient_name,
        recipient_residential_address=stamped.residential_address,
        identity_stamped_at=timezone.now() if stamped.name else None,
        amount=str(request.amount),
        issuance_type=request.issuance_type,
        reason=f"Issuance request: {request.reason}",
        initiated_by=executed_by or request.reviewed_by,
        idempotency_key=issuance_key(request),
    )
    request.refresh_from_db(fields=["status", "updated_at"])
    logger.info(f"Minting {request.amount} {token.symbol} to {recipient}")

    try:
        result = _mint_to(
            token.contract_address,
            recipient,
            request.amount,
            on_signed=lambda tx_hash, raw: record_signed_mint(request, issuance, attempt_id, tx_hash, raw),
        )
    except Exception as exc:
        logger.error(f"Issuance failed for request {request.uuid} ({type(exc).__name__})")
        detail = mint_failure_detail(exc)
        fail_mint_attempt(request, issuance, attempt_id, detail, ISSUANCE_EXECUTION_FAILED)
        if detail != str(exc):
            raise BaseChainTransactionError(detail) from None
        raise

    _complete_issuance(request, issuance, result)
    return result


def _resume_issuance(request: ShareIssuanceRequest, issuance: ShareIssuance) -> Optional[dict]:
    tx_hash = issuance.tx_hash
    if issuance.status == IssuanceStatus.COMPLETED:
        logger.info(f"mint {tx_hash} for request {request.uuid} already completed; nothing to send or wait on")
        request.refresh_from_db(fields=["status", "executed_issuance", "executed_at"])
        if request.status != RequestStatus.EXECUTED:
            request.mark_executed(issuance)
        return {"tx_hash": tx_hash, "block_number": issuance.block_number, "gas_used": issuance.gas_used}
    try:
        receipt = get_base_chain_client().get_transaction_receipt(tx_hash)
        if receipt is not None and receipt["status"] != 1:
            logger.warning(f"mint {tx_hash} for request {request.uuid} reverted; a fresh mint is safe")
            mark_mint_reverted(request, issuance, tx_hash)
            return None
        if receipt is None:
            _rebroadcast_mint(issuance)
            receipt = get_base_chain_client().wait_for_receipt(tx_hash)
    except Exception as exc:
        logger.error(f"mint {tx_hash} for request {request.uuid} still unconfirmed ({type(exc).__name__})")
        detail = mint_failure_detail(exc)
        fail_recorded_mint(request, issuance, tx_hash, detail, ISSUANCE_EXECUTION_FAILED)
        if detail != str(exc):
            raise BaseChainTransactionError(detail) from None
        raise

    logger.info(f"mint {tx_hash} for request {request.uuid} already mined; completing without sending")
    result = _tx_result(tx_hash, receipt)
    _complete_issuance(request, issuance, result)
    return result


def _rebroadcast_mint(issuance: ShareIssuance) -> None:
    raw_transaction = recorded_mint_payload(issuance)
    if raw_transaction is None:
        return
    try:
        answered_hash = get_base_chain_client().send_raw_transaction(raw_transaction)
    except Exception as exc:
        logger.warning(f"Mint replay remains unresolved for issuance {issuance.pk} ({type(exc).__name__})")
        return
    if answered_hash != issuance.tx_hash:
        raise InvalidTokenStateException("The node returned a different hash for the recorded mint.")


def _complete_issuance(request: ShareIssuanceRequest, issuance: ShareIssuance, result: dict) -> None:
    with atomic():
        current_request = ShareIssuanceRequest.objects.select_for_update().get(pk=request.pk)
        current = ShareIssuance.objects.select_for_update().get(pk=issuance.pk)
        if current.tx_hash != result["tx_hash"]:
            raise InvalidTokenStateException("The issuance now identifies a different mint transaction.")
        if current.status != IssuanceStatus.COMPLETED:
            current.mark_completed(
                tx_hash=result["tx_hash"], block_number=result["block_number"], gas_used=result["gas_used"]
            )
        if current_request.status != RequestStatus.EXECUTED:
            current_request.mark_executed(current)
    issuance.refresh_from_db()
    request.refresh_from_db()
    _seed_recipient_holding(request.token, issuance.recipient_address)
    logger.info(f"Issuance executed for {request.token.symbol}: {result['tx_hash']}")


def _seed_recipient_holding(token: ShareToken, recipient_address: str) -> None:
    from wallets.services.holdings import sync_holding
    from whitelist.models import WhitelistEntry

    try:
        matches = list(
            WhitelistEntry.objects.filter_by_address(recipient_address).select_related("wallet").order_by("uuid")[:2]
        )
        entry = matches[0] if len(matches) == 1 else None
        if entry is None or entry.wallet is None:
            logger.info(f"{recipient_address} is not an investor wallet; no {token.symbol} holding written")
            return
        asset = Asset.get_by_chain_and_contract(SHARE_ASSET_CHAIN, token.contract_address)
        if asset is None:
            logger.warning(f"{token.symbol} has no asset on {SHARE_ASSET_CHAIN}; no holding written")
            return
        sync_holding(entry.wallet, asset)
    except Exception as exc:
        logger.error(f"Could not record the {token.symbol} holding of {recipient_address}: {exc}")


def unnamed_mint(request: ShareIssuanceRequest) -> Optional[ShareIssuance]:
    recorded = ShareIssuance.objects.filter(idempotency_key=issuance_key(request)).first()
    if recorded is None or recorded.tx_hash or recorded.mint_journal is not None:
        return None
    if request.updated_at > timezone.now() - UNNAMED_MINT_GRACE:
        return None
    return recorded


@atomic()
def name_the_mint(request: ShareIssuanceRequest, tx_hash: str) -> ShareIssuance:
    issuance = unnamed_mint(request)
    if issuance is None:
        raise InvalidTokenStateException("This request has no unnamed mint to attach a transaction to.")
    issuance.mark_processing(tx_hash=tx_hash)
    logger.info(f"Request {request.uuid} had its mint named {tx_hash} by an operator")
    return issuance


def resolve_executing_issuance(request: ShareIssuanceRequest) -> Optional[str]:
    recorded = ShareIssuance.objects.filter(idempotency_key=issuance_key(request)).first()
    if recorded is None:
        logger.warning(f"Request {request.uuid} was claimed and no mint was recorded; releasing the claim")
        return "released" if release_unsigned_mint(request, CLAIMED_BEFORE_RECORDED) else None
    if not recorded.tx_hash:
        if release_unsigned_mint(request, STOPPED_BEFORE_SIGNING):
            return "released"
        logger.warning(
            f"Request {request.uuid} recorded a mint it never named, so the send may have gone out; "
            f"left for the operator"
        )
        return None
    issuance = recorded
    tx_hash = issuance.tx_hash
    receipt = get_base_chain_client().get_transaction_receipt(tx_hash)
    if receipt is None:
        _rebroadcast_mint(issuance)
        if issuance.mint_journal is None:
            return None
        receipt = get_base_chain_client().get_transaction_receipt(tx_hash)
        if receipt is None:
            return None
    if receipt["status"] != 1:
        logger.warning(f"mint {tx_hash} for request {request.uuid} reverted; the request can be retried")
        mark_mint_reverted(request, issuance, tx_hash, fail_request=True)
        return "reverted"
    logger.info(f"mint {tx_hash} for request {request.uuid} mined while the worker was gone; completing")
    _complete_issuance(request, issuance, _tx_result(tx_hash, receipt))
    return "executed"


def require_pausable(token: ShareToken, paused: bool) -> None:
    if paused and token.status != ShareTokenStatus.DEPLOYED:
        raise InvalidTokenStateException("Only deployed tokens can be paused.")
    if not paused and token.status not in (ShareTokenStatus.PAUSED, ShareTokenStatus.DEPLOYED):
        raise InvalidTokenStateException("Only paused tokens can be unpaused.")


def pause(token: ShareToken) -> None:
    require_pausable(token, True)
    _set_paused(token, True)


def unpause(token: ShareToken) -> None:
    require_pausable(token, False)
    if token.status == ShareTokenStatus.PAUSED or read_paused(token):
        _set_paused(token, False)
        return
    raise InvalidTokenStateException("Only paused tokens can be unpaused.")


def read_paused(token: ShareToken) -> bool:
    try:
        return load_share_token(token.contract_address).functions.paused().call()
    except BaseChainConnectionError as exc:
        raise TokenPauseFailedException("The chain is unreachable.") from exc
    except Exception as exc:
        logger.error(f"paused() could not be read for {token.symbol}: {exc}")
        raise TokenPauseFailedException("The token's paused state could not be read.") from exc


def _set_paused(token: ShareToken, paused: bool) -> None:
    function_name = "pause" if paused else "unpause"
    if read_paused(token) == paused:
        logger.warning(f"{token.symbol} is already {function_name}d on chain; reconciling the database status")
    else:
        try:
            contract_function = getattr(load_share_token(token.contract_address).functions, function_name)()
            tx_hash, _ = get_base_chain_client().send_transaction(
                contract_function, signer_key(), wait_for_receipt=True
            )
            logger.info(f"{function_name}() confirmed for {token.symbol}: {tx_hash}")
        except Exception as exc:
            logger.error(f"{function_name}() failed for {token.symbol}: {exc}")
            if not _paused_state_is(token, paused):
                raise TokenPauseFailedException(f"Token {function_name} failed.") from exc
            logger.warning(f"{function_name}() for {token.symbol} failed after the call mined; reconciling")
    if paused:
        token.mark_paused()
    else:
        token.mark_unpaused()


def _paused_state_is(token: ShareToken, paused: bool) -> bool:
    try:
        return read_paused(token) == paused
    except TokenPauseFailedException:
        return False


def get_token_balance(contract_address: str, holder: str) -> int:
    try:
        return _get_balance("ShareToken", contract_address, holder)
    except InvalidHolderAddressException:
        raise
    except Exception as e:
        logger.error(f"Error getting balance: {e}")
        raise TokenBalanceRetrievalException() from e


def get_wallet_token_balances(wallet_address: str) -> dict:
    wallet_checksum = _validate_address(wallet_address)

    balances = []

    tokens = ShareToken.objects.deployed_with_contract()
    for token in tokens:
        try:
            balance = get_token_balance(token.contract_address, wallet_checksum)
            if balance > 0:
                balances.append(
                    {
                        "token": str(token.uuid),
                        "symbol": token.symbol,
                        "name": token.name,
                        "balance": str(balance),
                        "contractAddress": token.contract_address,
                        "decimals": 0,
                        "type": "share_token",
                    }
                )
        except Exception as e:
            logger.error(f"Failed to get balance for {token.symbol}: {e}")
            raise WalletBalancesUnavailableException(
                f"{WalletBalancesUnavailableException.default_detail} The balance of {token.symbol} could "
                f"not be read."
            ) from e

    for deployment in settlement_deployments():
        asset = deployment.asset
        try:
            balance = _get_balance("AUDY", deployment.contract_address, wallet_checksum)
            if balance > 0:
                balances.append(
                    {
                        "token": str(asset.uuid),
                        "symbol": asset.symbol,
                        "name": asset.name,
                        "balance": str(balance),
                        "contractAddress": deployment.contract_address,
                        "decimals": deployment.decimals,
                        "type": "stablecoin",
                    }
                )
        except Exception as e:
            logger.error(f"Failed to get settlement asset balance for {asset.symbol}: {e}")
            raise WalletBalancesUnavailableException(
                f"{WalletBalancesUnavailableException.default_detail} The balance of {asset.symbol} could "
                f"not be read."
            ) from e

    return {"walletAddress": wallet_checksum, "balances": balances}


def delete_share_token(token) -> None:
    if token.is_on_chain:
        logger.warning(f"Refused to delete {token.symbol}: on chain at {token.contract_address}")
        raise DeployedShareClassException(token.symbol)

    logger.info(f"Deleting share class {token.symbol} for company {token.company_id}")
    token.delete()
