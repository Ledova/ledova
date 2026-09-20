import logging
from datetime import datetime
from datetime import timezone as dt_timezone
from typing import Optional

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from web3 import Web3

from assets.models import Asset, AssetType
from assets.services.identity import free_symbol, verified_contract_asset
from integrations.base_chain import get_base_chain_client
from integrations.base_chain.exceptions import (
    BaseChainConnectionError,
    BaseChainContractError,
)
from operators.settlement import settlement_deployments
from shared.constants import BLOCKCHAIN_BASE
from tokens.exceptions import (
    ContractLoadException,
    DeployedShareClassException,
    InvalidHolderAddressException,
    InvalidRecipientAddressException,
    InvalidTokenAddressException,
    InvalidTokenStateException,
    TokenBalanceRetrievalException,
    TokenFactoryNotConfiguredException,
    TokenPauseFailedException,
    WalletBalancesUnavailableException,
)
from tokens.models import (
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.querysets.share_issuance import ISSUANCE_KEY_PREFIX
from tokens.services.dilution import dilution_for

logger = logging.getLogger(__name__)

LOG_WINDOW = 2000

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
NOT_WHITELISTED = "Recipient wallet is not whitelisted. Whitelist it before executing."
EXCEEDS_AUTHORIZED = "Amount exceeds authorized shares. Submit a capital increase first."
TOKEN_PAUSED = "Token is paused. Unpause it before executing."
SHARE_ASSET_CHAIN = BLOCKCHAIN_BASE
NOT_ATTESTED = "{symbol} at {address} is not the address the factory holds for {identifier}; left unverified"


def factory_address() -> str:
    address = getattr(settings, "SHARE_TOKEN_FACTORY_ADDRESS", "")
    if not address:
        raise TokenFactoryNotConfiguredException(
            "SHARE_TOKEN_FACTORY_ADDRESS not configured. "
            "Please deploy the ShareTokenFactory contract and set the address."
        )
    return address


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


def transfer_logs(token_contract, from_block: int, to_block: int, window: int = LOG_WINDOW):
    if window <= 0:
        raise ValueError("Transfer-log window must be positive.")
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
        for entry in transfer_logs(load_share_token(contract_address), from_block, to_block, window)
    ]
    return sorted(entries, key=lambda item: (item["block_number"], item["log_index"]))


def block_date(block_number: int):
    stamp = get_base_chain_client().w3.eth.get_block(block_number)["timestamp"]
    return datetime.fromtimestamp(int(stamp), tz=dt_timezone.utc).date()


def transfer_participants(contract_address: str, from_block: int, window: int = LOG_WINDOW) -> set:
    return {
        address
        for entry in transfer_logs(load_share_token(contract_address), from_block, head_block(), window)
        for address in (entry["args"]["from"], entry["args"]["to"])
    }


def share_supply(contract_address: str) -> tuple[int, int]:
    token_contract = load_share_token(contract_address)
    return token_contract.functions.authorizedShares().call(), token_contract.functions.totalSupply().call()


def is_recipient_whitelisted(address: str) -> bool:
    from whitelist.services import whitelist

    return whitelist.is_whitelisted(address)


def issuance_key(request: ShareIssuanceRequest) -> str:
    return f"{ISSUANCE_KEY_PREFIX}{request.uuid}"


def broadcast_mint(request: ShareIssuanceRequest) -> Optional[ShareIssuance]:
    return ShareIssuance.objects.broadcast().filter(idempotency_key=issuance_key(request)).first()


def seed_recipient_holding(contract_address: str, recipient_address: str) -> None:
    from wallets.services.holdings import sync_holding
    from whitelist.models import WhitelistEntry

    try:
        matches = list(
            WhitelistEntry.objects.filter_by_address(recipient_address).select_related("wallet").order_by("uuid")[:2]
        )
        entry = matches[0] if len(matches) == 1 else None
        if entry is None or entry.wallet is None:
            logger.info(f"{recipient_address} is not an investor wallet; no {contract_address} holding written")
            return
        asset = Asset.get_by_chain_and_contract(SHARE_ASSET_CHAIN, contract_address)
        if asset is None:
            logger.warning(f"{contract_address} has no asset on {SHARE_ASSET_CHAIN}; no holding written")
            return
        sync_holding(entry.wallet, asset)
    except Exception:
        logger.error(
            "Could not record the holding for contract %s and recipient %s", contract_address, recipient_address
        )


def read_paused(token: ShareToken) -> bool:
    try:
        return load_share_token(token.contract_address).functions.paused().call()
    except BaseChainConnectionError as exc:
        raise TokenPauseFailedException("The chain is unreachable.") from exc
    except Exception as exc:
        logger.error(f"paused() could not be read for {token.symbol}: {exc}")
        raise TokenPauseFailedException("The token's paused state could not be read.") from exc


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
