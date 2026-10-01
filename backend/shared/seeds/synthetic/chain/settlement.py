from decimal import Decimal

from web3 import Web3

from assets.models import Asset, AssetChainDeployment
from assets.services.exchange_rate import ExchangeRateService
from assets.services.sync import SUPPORTED_ASSETS, ensure_supported_assets, update_price
from integrations.base_chain import get_base_chain_client
from operators.models import Operator
from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.guard import operator_address
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Holding

AUDY = "AUDY"
WEI = Decimal(10) ** 18
OPERATOR_GAS_FLOOR = Decimal("1")
BALANCE_METHODS = ("hardhat_setBalance", "anvil_setBalance")
NOT_FUNDED = "The node accepted neither {methods} for {address}, so the hourly wallet sync would replace its balance."
OTHER_SETTLEMENT = (
    "The operator already settles otherwise ({detail}), and the chain layer makes AUDY on Base its single "
    "settlement asset. Clear those fields on the operator in the admin, then run make dev-seed again."
)


def settlement_refusal():
    operator = Operator.get()
    supported = sorted(operator.supported_settlement_assets.values_list("symbol", flat=True))
    issued = operator.issued_stablecoin.symbol if operator.issued_stablecoin_id else AUDY
    chain = operator.receiving_wallet_chain if operator.receiving_wallet_address else BLOCKCHAIN_BASE
    detail = []
    if supported not in ([], [AUDY]):
        detail.append(f"settlement assets {', '.join(supported)}")
    if issued != AUDY:
        detail.append(f"issued stablecoin {issued}")
    if chain != BLOCKCHAIN_BASE:
        detail.append(f"receiving wallet on {chain}")
    return OTHER_SETTLEMENT.format(detail="; ".join(detail)) if detail else None


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
        if not _set_balance(provider, address, int(holding.quantity * WEI)):
            raise ChainStepFailed(NOT_FUNDED.format(methods=" nor ".join(BALANCE_METHODS), address=address))
        funded += 1
    return funded
