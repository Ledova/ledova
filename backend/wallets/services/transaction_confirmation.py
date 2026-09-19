import logging
from decimal import Decimal
from typing import Any, Dict, Optional
from uuid import uuid4

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from procrastinate import App
from procrastinate.contrib.django.django_connector import DjangoConnector

from assets.models import Asset, AssetType
from assets.services.identity import (
    native_asset_for_chain,
    recorded_native_asset_for_chain,
)
from compliance.services.transaction_monitoring import TransactionMonitoringService
from shared.constants import normalize_chain
from shared.db import atomic, current_alias
from users.tasks.notifications import send_transaction_notification
from wallets.constants import (
    SNAPSHOT_REASON_TRANSACTION,
    TRANSACTION_STATUS_CONFIRMED,
    TRANSACTION_STATUS_FAILED,
    TRANSACTION_STATUS_PENDING,
)
from wallets.exceptions import InvalidTransactionException
from wallets.models import (
    Holding,
    HoldingSnapshot,
    Transaction,
    Wallet,
    WalletChainWatch,
)
from wallets.services.chain_observations import (
    final_receipt,
    finality_policy,
    receipt_target_fingerprint,
    settled_chain_observation,
)
from wallets.services.holdings import sync_holding
from wallets.services.receipt_metadata import apply_receipt_metadata
from wallets.services.receipt_targets import capture_receipt_target

logger = logging.getLogger(__name__)

NOT_TRANSFERABLE = "{symbol} is a tokenized security. Shares move by allotment, not by a wallet transfer."


def resolve_transfer_asset(wallet: Wallet, token_contract: Optional[str] = None) -> Asset:
    if not token_contract:
        return native_asset_for_chain(wallet.chain)

    asset = Asset.get_by_chain_and_contract(wallet.chain, token_contract)
    if asset is None or not asset.is_verified:
        raise InvalidTransactionException(
            f"Token contract {token_contract} is not a verified asset on {normalize_chain(wallet.chain)}."
        )
    if asset.asset_type == AssetType.TOKENIZED_SECURITY.value:
        raise InvalidTransactionException(NOT_TRANSFERABLE.format(symbol=asset.symbol))
    return asset


def create_pending_transaction(
    wallet: Wallet,
    tx_hash: str,
    to_address: str,
    amount: Decimal,
    transaction_fee: Optional[Decimal] = None,
    token_contract: Optional[str] = None,
) -> Dict[str, Any]:
    chain = normalize_chain(wallet.chain)
    asset = resolve_transfer_asset(wallet, token_contract)

    with atomic():
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        tx = Transaction.objects.create(
            wallet=wallet,
            tx_hash=tx_hash,
            chain=chain,
            from_address=wallet.address,
            to_address=to_address,
            asset=asset,
            amount=amount,
            transaction_fee_estimated=transaction_fee,
            transaction_fee=None,
            status=TRANSACTION_STATUS_PENDING,
            block_timestamp=None,
            block_number=None,
        )
        TransactionMonitoringService.queue_new_transaction(tx)

        fee = transaction_fee or Decimal("0")
        native = native_asset_for_chain(wallet.chain)

        if asset == native:
            holding, taken = _move_holding(tx, asset, -(amount + fee))
            tx.deducted_amount = -taken
            tx.deducted_amount_sync_version = holding.sync_version
        else:
            holding, taken = _move_holding(tx, asset, -amount)
            tx.deducted_amount = -taken
            tx.deducted_amount_sync_version = holding.sync_version
            if fee:
                native_holding, taken_fee = _move_holding(tx, native, -fee)
                tx.deducted_fee = -taken_fee
                tx.deducted_fee_sync_version = native_holding.sync_version
        tx.save(
            update_fields=[
                "deducted_amount",
                "deducted_fee",
                "deducted_amount_sync_version",
                "deducted_fee_sync_version",
            ]
        )

        logger.info(
            "Created pending transaction: "
            f"tx_hash={tx_hash}, wallet={wallet.address[:10]}..., "
            f"amount={amount} {asset.symbol}, fee={fee} {native.symbol}, new_balance={holding.quantity}"
        )

    return {
        "transaction_id": str(tx.uuid),
        "tx_hash": tx_hash,
        "status": TRANSACTION_STATUS_PENDING,
        "holding_quantity": str(holding.quantity),
    }


def settle_observed_transaction(tx_hash: str, *, wallet: Wallet) -> Dict[str, Any]:
    with atomic(durable=True):
        locked_wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        tx = Transaction.objects.select_for_update().filter(tx_hash=tx_hash, wallet=locked_wallet).first()
        if tx is None:
            return {"status": "not_found", "tx_hash": tx_hash}
        first_settlement = tx.status == TRANSACTION_STATUS_PENDING
        if not first_settlement:
            if (
                tx.balance_reconciliation_token is None
                or settled_chain_observation(tx, require_current_policy=False) is None
                or settled_chain_observation(tx) is not None
            ):
                return {"status": "already_processed", "current_status": tx.status}
        watch = WalletChainWatch.objects.select_related("latest_observation").filter(transaction=tx).first()
        observation = watch.latest_observation if watch is not None else None
        if observation is None:
            return {"status": "attribution_pending", "tx_hash": tx_hash}
        if (
            tx.imported_from_history
            or (watch.wallet_id, watch.user_account_id, watch.chain, watch.tx_hash)
            != (locked_wallet.pk, locked_wallet.user_account_id, tx.chain, tx.tx_hash)
            or watch.generation != observation.generation
            or watch.last_started_at != observation.started_at
            or watch.target_fingerprint != observation.target_fingerprint
            or receipt_target_fingerprint(capture_receipt_target(locked_wallet, tx)) != observation.target_fingerprint
            or observation.policy != finality_policy(watch.network, watch.chain)
        ):
            return {"status": "observation_changed", "tx_hash": tx_hash}
        receipt = final_receipt(observation)
        if receipt is None:
            return {"status": "finality_pending", "tx_hash": tx_hash}
        previous = watch.observations.filter(result="included").order_by("generation").first()
        if previous.evidence.get("receipt", {}).get("succeeded") is not receipt["succeeded"]:
            return {"status": "attribution_pending", "tx_hash": tx_hash}
        tx.status = TRANSACTION_STATUS_CONFIRMED if receipt["succeeded"] else TRANSACTION_STATUS_FAILED
        fields = apply_receipt_metadata(
            tx,
            block_hash=receipt["hash"],
            block_number=receipt["height"],
            block_timestamp=parse_datetime(receipt["timestamp"]) if receipt["timestamp"] is not None else None,
            actual_fee=Decimal(receipt["actual_fee"]) if receipt["actual_fee"] is not None else None,
        )
        tx.finality_observation = observation
        tx.balance_reconciliation_token = tx.balance_reconciliation_token or uuid4()
        tx.save(update_fields=["status", "finality_observation", "balance_reconciliation_token", "updated_at", *fields])
        _invalidate_balance_reads(tx)
        if first_settlement:
            _notify_wallet_users(tx, tx.status)
        result = {"status": tx.status, "tx_hash": tx_hash, "block_number": tx.block_number}
    repaired = reconcile_transaction(tx_hash, wallet=wallet)
    if not first_settlement:
        result["status"] = "reconciled" if repaired else "reconciliation_pending"
    return result


def _invalidate_balance_reads(tx: Transaction) -> None:
    native = recorded_native_asset_for_chain(tx.wallet.chain)
    Holding.objects.filter(wallet=tx.wallet, asset__in=[tx.asset, native]).update(balance_version=uuid4())


def reconcile_transaction(tx_hash: str, *, wallet: Wallet) -> bool:
    tx = (
        Transaction.objects.select_related("asset", "finality_observation__watch")
        .filter(tx_hash=tx_hash, wallet=wallet)
        .first()
    )
    if tx is None or tx.balance_reconciliation_token is None:
        return True
    observation = settled_chain_observation(tx)
    if observation is None:
        return False
    watch = observation.watch
    expected = capture_receipt_target(wallet, tx)
    holdings = _verify_holding_balance(wallet, tx.asset)
    if holdings is None:
        return False
    with atomic():
        locked_wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        locked = Transaction.objects.select_for_update().get(pk=tx.pk)
        if capture_receipt_target(locked_wallet, locked) != expected:
            return False
        if observation.policy != finality_policy(watch.network, watch.chain):
            return False
        for holding in holdings:
            if not Holding.objects.filter(pk=holding.pk, balance_version=holding.balance_version).exists():
                return False
        if locked.status == TRANSACTION_STATUS_CONFIRMED:
            _update_snapshot_on_confirmation(locked)
        locked.deducted_amount = Decimal("0")
        locked.deducted_fee = Decimal("0")
        locked.balance_reconciliation_token = None
        locked.save(update_fields=["balance_reconciliation_token", "deducted_amount", "deducted_fee"])
    return True


def _notify_wallet_users(tx: Transaction, event: str) -> None:
    owner = tx.wallet.user_account.user_profile.user
    queue = App(connector=DjangoConnector(alias=current_alias()))
    queue.configure_task(send_transaction_notification.name).defer(
        user_id=str(owner.pk), transaction_id=str(tx.uuid), event_type=event
    )


def _move_holding(tx: Transaction, asset: Asset, delta: Decimal) -> tuple[Holding, Decimal]:
    holding, _ = Holding.objects.select_for_update().get_or_create(
        wallet=tx.wallet,
        asset=asset,
        defaults={"quantity": Decimal("0")},
    )

    before = holding.quantity
    holding.quantity = max(Decimal("0"), before + delta)
    holding.balance_version = uuid4()
    holding.save(update_fields=["quantity", "balance_version", "updated_at"])

    HoldingSnapshot.objects.update_or_create(
        holding=holding,
        snapshot_date=timezone.now().date(),
        defaults={
            "quantity": holding.quantity,
            "snapshot_reason": SNAPSHOT_REASON_TRANSACTION,
            "caused_by_transaction": tx,
        },
    )
    return holding, holding.quantity - before


def _verify_holding_balance(wallet: Wallet, asset: Asset):
    native = recorded_native_asset_for_chain(wallet.chain)
    if native is None:
        return None
    holdings = [sync_holding(wallet, held_asset) for held_asset in dict.fromkeys([asset, native])]
    return None if any(holding is None for holding in holdings) else holdings


def _update_snapshot_on_confirmation(tx: Transaction) -> None:
    if not tx.block_timestamp:
        return

    snapshot_date = tx.block_timestamp.date()
    holding = Holding.objects.filter(wallet=tx.wallet, asset=tx.asset).first()

    if not holding:
        return

    HoldingSnapshot.objects.update_or_create(
        holding=holding,
        snapshot_date=snapshot_date,
        defaults={
            "quantity": holding.quantity,
            "block_number": tx.block_number,
            "snapshot_reason": SNAPSHOT_REASON_TRANSACTION,
            "caused_by_transaction": tx,
        },
    )
