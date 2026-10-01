from decimal import Decimal

from web3 import Web3

from assets.models import Asset, AssetChainDeployment
from assets.services.exchange_rate import ExchangeRateService
from assets.services.sync import SUPPORTED_ASSETS, ensure_supported_assets, update_price
from integrations.base_chain import get_base_chain_client
from operators.models import Operator
from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic
from shared.seeds.synthetic.chain.guard import operator_address
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Holding

AUDY = "AUDY"
WEI = Decimal(10) ** 18
OPERATOR_GAS_FLOOR = Decimal("1")
BALANCE_METHODS = ("hardhat_setBalance", "anvil_setBalance")


def configure_settlement(plan, records):
    with atomic():
        ensure_supported_assets()
        audy = Asset.objects.get(symbol=AUDY)
        AssetChainDeployment.objects.filter(asset=audy, chain=BLOCKCHAIN_BASE).update(is_active=True)
        operator = Operator.get()
        if not operator.receiving_wallet_address:
            operator.receiving_wallet_address = plan.receiving_wallet
            operator.receiving_wallet_chain = BLOCKCHAIN_BASE
        if operator.issued_stablecoin_id is None:
            operator.issued_stablecoin = audy
        operator.full_clean()
        operator.save()
        if not operator.supported_settlement_assets.exists():
            operator.supported_settlement_assets.set([audy])
        rate = ExchangeRateService.get_rate("USD", SUPPORTED_ASSETS[AUDY]["par_currency"])
        if rate:
            update_price(audy, SUPPORTED_ASSETS[AUDY]["par_value"] / rate, source="par_reference")
    records.audy = audy
    return audy


def _set_balance(provider, address, wei):
    for method in BALANCE_METHODS:
        if "error" not in provider.make_request(method, [address, hex(wei)]):
            return True
    return False


def fund_wallets():
    provider = get_base_chain_client().w3.provider
    operator = operator_address().lower()
    funded = 0
    holdings = Holding.objects.filter(
        wallet__chain=BLOCKCHAIN_BASE,
        wallet__verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        asset__symbol="ETH",
    ).select_related("wallet")
    for holding in holdings.order_by("wallet__address"):
        address = Web3.to_checksum_address(holding.wallet.address)
        if address.lower() == operator and holding.quantity < OPERATOR_GAS_FLOOR:
            continue
        funded += _set_balance(provider, address, int(holding.quantity * WEI))
    return funded
