from unittest.mock import patch

from web3 import Web3

from assets.models import Asset
from shared.constants import BLOCKCHAIN_BASE
from tokens.models import ShareToken, ShareTokenStatus
from tokens.services import share_token_service


def a_deployed_class(company, symbol, name, number):
    address = Web3.to_checksum_address("0x" + f"{number:040x}")
    token = ShareToken.objects.create(
        company=company,
        name=name,
        symbol=symbol,
        total_supply="1000",
        status=ShareTokenStatus.DEPLOYED,
        contract_address=address,
        chain=BLOCKCHAIN_BASE,
        deployment_tx_hash="0x" + f"{number:064x}",
    )
    with patch.object(share_token_service, "get_token_by_identifier", return_value=address):
        if not share_token_service.bridge_share_asset(token, address):
            raise AssertionError(f"{symbol} at {address} was not bridged")
    return token, Asset.objects.get(
        chain_deployments__chain=BLOCKCHAIN_BASE, chain_deployments__contract_address=address
    )


def two_ordinary_classes(first_company, second_company):
    first = a_deployed_class(first_company, "ORD", "Ordinary Shares", 0xA1)
    second = a_deployed_class(second_company, "ORD", "Ordinary Shares", 0xB2)
    return first, second
