import logging
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from django.utils import timezone

from assets.models import Asset
from assets.services.identity import recorded_native_asset_for_chain
from operators.settlement import deployment_for, single_settlement_asset
from shared.db import atomic
from tokens.models import ShareToken
from wallets.models import Holding, Transaction, Wallet
from wallets.services.chain import fetch_chain_balance
from wallets.services.chain_observations import settled_chain_observation
from whitelist.models import WhitelistApproval

logger = logging.getLogger(__name__)


def sync_holding(wallet, asset, *, create_empty=True) -> Optional[Holding]:
    wallet = Wallet.objects.get(pk=wallet.pk)
    wallet_identity = (wallet.user_account_id, wallet.chain, wallet.address)
    expected = Holding.objects.filter(wallet=wallet, asset=asset).values_list("uuid", "balance_version").first()
    balance = fetch_chain_balance(wallet, asset)
    if balance is None:
        logger.info(f"No chain balance for {asset.symbol} on {wallet.chain}; holding left untouched")
        return None

    with atomic():
        locked_wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        if (locked_wallet.user_account_id, locked_wallet.chain, locked_wallet.address) != wallet_identity:
            return None
        holding = Holding.objects.select_for_update().filter(wallet=wallet, asset=asset).first()
        actual = (holding.pk, holding.balance_version) if holding is not None else None
        if expected != actual:
            logger.info("Holding changed while its balance was being read; the stale observation was discarded")
            return None
        unresolved = Transaction.objects.holding_unresolved(
            wallet, asset, recorded_native_asset_for_chain(wallet.chain)
        ).select_related("finality_observation__watch")
        capped = any(settled_chain_observation(tx) is None for tx in unresolved)
        if holding is None:
            if not create_empty and (balance <= 0 or capped):
                return None
            holding = Holding.objects.create(wallet=wallet, asset=asset, quantity=Decimal("0"))
        if capped:
            balance = min(balance, holding.quantity)
        if holding.quantity != balance:
            logger.info(
                f"Corrected {asset.symbol} on {wallet.chain} "
                f"from {holding.quantity} to {balance} for wallet {wallet.uuid}"
            )
        holding.quantity = balance
        holding.last_synced_at = timezone.now()
        holding.balance_version = uuid4()
        if not capped:
            holding.sync_version = holding.balance_version
        holding.save(update_fields=["quantity", "last_synced_at", "balance_version", "sync_version", "updated_at"])
    return None if capped else holding


def approved_share_assets(wallet) -> list[Asset]:
    approved = WhitelistApproval.objects.filter(entry__wallet_id=wallet.pk).values("company_id")
    classes = ShareToken.objects.deployed_with_contract().filter(chain=wallet.chain, company_id__in=approved)
    assets = [Asset.get_by_chain_and_contract(wallet.chain, token.contract_address) for token in classes]
    return [asset for asset in assets if asset is not None and asset.is_verified]


def settlement_asset_on(wallet) -> list[Asset]:
    asset = single_settlement_asset()
    deployment = deployment_for(asset)
    if asset is None or not asset.is_verified or deployment is None or deployment.chain != wallet.chain:
        return []
    return [asset]


def discover_holdings(wallet) -> list[Holding]:
    recorded = set(Holding.objects.filter(wallet_id=wallet.pk).values_list("asset_id", flat=True))
    found = []
    for asset in approved_share_assets(wallet) + settlement_asset_on(wallet):
        if asset.pk in recorded:
            continue
        holding = sync_holding(wallet, asset, create_empty=False)
        if holding is not None:
            logger.info(f"Found {holding.quantity} {asset.symbol} on {wallet.chain} for wallet {wallet.uuid}")
            found.append(holding)
    return found
