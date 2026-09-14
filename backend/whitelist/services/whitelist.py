import logging
from datetime import datetime
from datetime import timezone as dt_timezone

from django.conf import settings
from django.utils import timezone
from web3 import Web3

from blockchain.models import BlockchainTransaction, TransactionType
from integrations.base_chain import get_base_chain_client
from shared.constants import BLOCKCHAIN_BASE
from wallets.models import Wallet
from whitelist.constants import (
    WHITELIST_STATUS_NOT_WHITELISTED,
    WHITELIST_STATUS_UNKNOWN,
    WHITELIST_STATUS_WHITELISTED,
)
from whitelist.exceptions import (
    WalletNotRegisteredException,
    WhitelistContractNotConfiguredException,
)
from whitelist.models import WhitelistChange, WhitelistEntry, WhitelistStatus

logger = logging.getLogger(__name__)
WHITELIST_ENTRY_LABEL = "whitelist.WhitelistEntry"


def contract():
    address = getattr(settings, "WHITELIST_CONTRACT_ADDRESS", None)
    if not address:
        raise WhitelistContractNotConfiguredException()
    return get_base_chain_client().load_contract("WhitelistRegistry", address)


def is_whitelisted(address):
    return contract().functions.isWhitelisted(Web3.to_checksum_address(address)).call()


def get_investor_info(address):
    result = contract().functions.getInvestorInfo(Web3.to_checksum_address(address)).call()
    return {"whitelisted": result[0], "kyc_timestamp": result[1]}


def can_receive(address):
    return contract().functions.canReceive(Web3.to_checksum_address(address)).call()


def unique_wallet_uuid_for(address):
    wallet_ids = list(
        Wallet.objects.filter_by_address(address, chain=BLOCKCHAIN_BASE)
        .order_by("uuid")
        .values_list("uuid", flat=True)[:2]
    )
    if len(wallet_ids) != 1:
        raise WalletNotRegisteredException()
    return wallet_ids[0]


def resolve_entry(address, wallet_uuid=None):
    if wallet_uuid is None:
        treasury = WhitelistEntry.objects.filter(wallet__isnull=True, address__iexact=address).first()
        if treasury is not None:
            return treasury
    wallets = Wallet.objects.filter_by_address(address, chain=BLOCKCHAIN_BASE).order_by("uuid")
    if wallet_uuid is not None:
        wallet = wallets.filter(uuid=wallet_uuid).first()
    else:
        matches = list(wallets[:2])
        wallet = matches[0] if len(matches) == 1 else None
    if wallet is None:
        raise WalletNotRegisteredException()
    entry, _ = WhitelistEntry.objects.get_or_create(wallet=wallet, defaults={"status": WhitelistStatus.PENDING})
    return entry


def investor_status(address):
    try:
        info = get_investor_info(address)
        return {
            "address": Web3.to_checksum_address(address),
            "is_whitelisted": info["whitelisted"],
            "can_receive": can_receive(address),
            "status": WHITELIST_STATUS_WHITELISTED if info["whitelisted"] else WHITELIST_STATUS_NOT_WHITELISTED,
        }
    except Exception:
        logger.warning("Whitelist membership could not be read")
        return {"address": address, "is_whitelisted": False, "can_receive": False, "status": WHITELIST_STATUS_UNKNOWN}


def sync_entry(address, wallet_uuid=None):
    from whitelist.services.changes import target_transaction

    address = Web3.to_checksum_address(address)
    entry = resolve_entry(address, wallet_uuid=wallet_uuid)
    version = entry.updated_at
    info = get_investor_info(address)
    registry = settings.WHITELIST_CONTRACT_ADDRESS
    with target_transaction(settings.BLOCKCHAIN_CHAIN_ID, registry, address):
        entry = WhitelistEntry.objects.select_for_update().get(pk=entry.pk)
        if entry.updated_at != version:
            return entry
        moment = timezone.now()
        values = {
            "is_whitelisted": info["whitelisted"],
            "on_chain_timestamp": (
                datetime.fromtimestamp(info["kyc_timestamp"], tz=dt_timezone.utc) if info["kyc_timestamp"] else None
            ),
            "last_synced_at": moment,
            "updated_at": moment,
        }
        if (
            not WhitelistChange.objects.for_target(settings.BLOCKCHAIN_CHAIN_ID, registry, address)
            .unresolved()
            .exists()
        ):
            values["status"] = WhitelistStatus.ACTIVE if info["whitelisted"] else WhitelistStatus.REMOVED
        WhitelistEntry.objects.filter(pk=entry.pk).update(**values)
        entry.refresh_from_db()
        return entry


def sync_entries(entries):
    result = {"synced": 0, "errors": []}
    for entry in entries:
        try:
            sync_entry(entry.wallet_address, wallet_uuid=entry.wallet_id)
            result["synced"] += 1
        except Exception:
            result["errors"].append(f"Could not sync whitelist entry {entry.pk}.")
            logger.warning("Whitelist sync failed: entry=%s", entry.pk)
    return result


def sync_all_entries():
    entries = list(WhitelistEntry.objects.active() | WhitelistEntry.objects.pending())
    return sync_entries(entries)["synced"]


def _the_write_that_failed_was_an_add(entry):
    latest = (
        BlockchainTransaction.objects.filter(related_model=WHITELIST_ENTRY_LABEL, related_uuid=entry.pk)
        .order_by("-created_at")
        .values_list("tx_type", flat=True)
        .first()
    )
    return latest == TransactionType.WHITELIST_ADD


def reconcile_failed_adds():
    result = {"checked": 0, "activated": 0, "left_failed": 0, "removals_the_chain_kept": 0, "errors": []}
    for entry in WhitelistEntry.objects.failed_with_a_sent_add().filter(changes__isnull=True):
        result["checked"] += 1
        try:
            member = is_whitelisted(entry.wallet_address)
        except Exception:
            result["errors"].append(f"Could not read whitelist entry {entry.pk}.")
            logger.warning("Legacy whitelist observation failed: entry=%s", entry.pk)
            continue
        if not member:
            result["left_failed"] += 1
            continue
        if not _the_write_that_failed_was_an_add(entry):
            result["left_failed"] += 1
            if entry.record_the_chain_still_lists_it():
                result["removals_the_chain_kept"] += 1
                logger.warning("A failed whitelist removal is still listed: entry=%s", entry.pk)
            continue
        changed = WhitelistEntry.objects.filter(
            pk=entry.pk, status=WhitelistStatus.FAILED, updated_at=entry.updated_at, changes__isnull=True
        ).update(
            status=WhitelistStatus.ACTIVE, is_whitelisted=True, last_synced_at=timezone.now(), updated_at=timezone.now()
        )
        result["activated"] += changed
    return result
