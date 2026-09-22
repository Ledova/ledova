import logging
from datetime import datetime
from datetime import timezone as dt_timezone

from django.conf import settings
from django.utils import timezone
from web3 import Web3

from integrations.base_chain import get_base_chain_client
from shared.constants import BLOCKCHAIN_BASE
from wallets.models import Wallet
from whitelist.constants import (
    WHITELIST_NO_EXPIRY,
    WHITELIST_STATUS_NOT_WHITELISTED,
    WHITELIST_STATUS_UNKNOWN,
    WHITELIST_STATUS_WHITELISTED,
)
from whitelist.exceptions import (
    WalletNotRegisteredException,
    WhitelistRegistryMissing,
    WhitelistRegistryUnreadable,
)
from whitelist.models import (
    WhitelistApproval,
    WhitelistChange,
    WhitelistEntry,
    WhitelistStatus,
)

logger = logging.getLogger(__name__)


def registry_contract(registry_address, client=None):
    client = client or get_base_chain_client()
    return client.load_contract("WhitelistRegistry", Web3.to_checksum_address(registry_address))


def registry_for(company, client=None):
    factory = settings.SHARE_TOKEN_FACTORY_ADDRESS
    if not factory or not company.acn:
        raise WhitelistRegistryMissing()
    client = client or get_base_chain_client()
    try:
        contract = client.load_contract("ShareTokenFactory", Web3.to_checksum_address(factory))
        address = contract.functions.registryOf(company.acn).call()
    except Exception:
        logger.warning("The whitelist registry could not be read: company=%s", company.pk)
        raise WhitelistRegistryUnreadable() from None
    if not isinstance(address, str) or not Web3.is_address(address) or int(address, 16) == 0:
        raise WhitelistRegistryMissing()
    return address.lower()


def token_registry(token_address, client=None):
    client = client or get_base_chain_client()
    token = client.load_contract("ShareToken", Web3.to_checksum_address(token_address))
    return token.functions.whitelist().call()


def is_whitelisted(token_address, address):
    client = get_base_chain_client()
    registry = registry_contract(token_registry(token_address, client), client)
    return registry.functions.isWhitelisted(Web3.to_checksum_address(address)).call()


def approved_for_any_company(address):
    entries = WhitelistEntry.objects.filter_by_address(address)
    return WhitelistApproval.objects.filter(entry__in=entries).live().exists()


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
    entry, _ = WhitelistEntry.objects.get_or_create(wallet=wallet)
    return entry


def share_class_at(token_address):
    from tokens.models import ShareToken

    return ShareToken.objects.on_chain().filter(contract_address__iexact=token_address).first()


def investor_status(token, address):
    try:
        listed = is_whitelisted(token.contract_address, address)
        if type(listed) is not bool:
            raise ValueError("The registry did not answer with a boolean.")
        return {
            "address": Web3.to_checksum_address(address),
            "is_whitelisted": listed,
            "status": WHITELIST_STATUS_WHITELISTED if listed else WHITELIST_STATUS_NOT_WHITELISTED,
        }
    except Exception:
        logger.warning("Whitelist membership could not be read: token=%s", token.pk)
        return {"address": address, "is_whitelisted": False, "status": WHITELIST_STATUS_UNKNOWN}


def expiry_datetime(expiry):
    if expiry in (0, WHITELIST_NO_EXPIRY):
        return None
    return datetime.fromtimestamp(expiry, tz=dt_timezone.utc)


def approval_values(expiry):
    if type(expiry) is not int or not 0 <= expiry <= WHITELIST_NO_EXPIRY:
        raise ValueError("The registry did not answer with a uint64 expiry.")
    status = WhitelistStatus.REMOVED if expiry == 0 else WhitelistStatus.ACTIVE
    return {"status": status, "expires_at": expiry_datetime(expiry)}


def open_approval(entry, company, registry_address):
    approval, created = WhitelistApproval.objects.select_for_update().get_or_create(
        entry=entry, company=company, defaults={"registry_address": registry_address}
    )
    values = {"status": WhitelistStatus.PENDING, "updated_at": timezone.now()}
    if not created and approval.registry_address != registry_address:
        values |= {"registry_address": registry_address, "expires_at": None, "last_synced_at": None}
    WhitelistApproval.objects.filter(pk=approval.pk).update(**values)


def _current_approval(entry_id, company_id, chain_id, registry_address):
    if settings.BLOCKCHAIN_CHAIN_ID != chain_id:
        return None
    return WhitelistApproval.objects.filter(entry_id=entry_id, company_id=company_id, registry_address=registry_address)


def project_membership(entry_id, address, chain_id, registry_address, company_id, values, *, version=None):
    if _current_approval(entry_id, company_id, chain_id, registry_address) is None:
        return False
    identity = WhitelistEntry.objects.filter(pk=entry_id).values("wallet_id").first()
    if identity is None:
        return False
    if identity["wallet_id"]:
        Wallet.objects.select_for_update().filter(pk=identity["wallet_id"]).first()
    entry = WhitelistEntry.objects.matching_identity(entry_id, address).select_for_update(of=("self",)).first()
    if entry is None or entry.wallet_id != identity["wallet_id"]:
        return False
    approval = _current_approval(entry_id, company_id, chain_id, registry_address).select_for_update().first()
    if approval is None or (version is not None and approval.updated_at != version):
        return False
    WhitelistApproval.objects.filter(pk=approval.pk).update(**values)
    return True


def with_current_approval(change):
    approvals = _current_approval(change.entry_id, change.company_id, change.chain_id, change.registry_address)
    entry = WhitelistEntry.objects.matching_identity(change.entry_id, change.address).first()
    change.approval = approvals.select_related("company").first() if approvals is not None and entry else None
    return change


def sync_approval(approval):
    from whitelist.services.changes import target_transaction

    address = Web3.to_checksum_address(approval.entry.wallet_address)
    chain_id = settings.BLOCKCHAIN_CHAIN_ID
    registry = approval.registry_address
    version = approval.updated_at
    observed = approval_values(registry_contract(registry).functions.expiresAt(address).call())
    with target_transaction(chain_id, registry, address):
        moment = timezone.now()
        values = {"last_synced_at": moment, "updated_at": moment}
        if not WhitelistChange.objects.for_target(chain_id, registry, address).unresolved().exists():
            values |= observed
        project_membership(approval.entry_id, address, chain_id, registry, approval.company_id, values, version=version)


def sync_approvals(approvals):
    result = {"synced": 0, "errors": []}
    for approval in approvals:
        try:
            sync_approval(approval)
            result["synced"] += 1
        except Exception:
            result["errors"].append(f"Could not sync whitelist approval {approval.pk}.")
            logger.warning("Whitelist sync failed: approval=%s", approval.pk)
    return result


def sync_entry(address, wallet_uuid=None):
    entry = resolve_entry(Web3.to_checksum_address(address), wallet_uuid=wallet_uuid)
    for approval in WhitelistApproval.objects.filter(entry=entry).select_related("entry__wallet"):
        sync_approval(approval)
    current = WhitelistEntry.objects.filter(pk=entry.pk).first()
    if current is None:
        raise WalletNotRegisteredException()
    return current


def sync_all_entries():
    approvals = WhitelistApproval.objects.to_sync().select_related("entry__wallet")
    return sync_approvals(list(approvals))["synced"]
