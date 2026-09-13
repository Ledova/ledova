from collections import defaultdict
from typing import NamedTuple

from whitelist.models import HolderType, WhitelistEntry

TREASURY_FALLBACK = "Operator (treasury/custodian)"
AMBIGUOUS_NAME = "Two wallets share this address"
ADDRESS_CHUNK = 500


class HolderIdentity(NamedTuple):

    holder_type: str
    name: str
    residential_address: str
    whitelist_status: str


UNIDENTIFIED = HolderIdentity(HolderType.UNIDENTIFIED.value, "", "", "")


class UnnameableAddresses(NamedTuple):

    ambiguous: int
    unidentified: int


def _holder(entry: WhitelistEntry):
    if entry.wallet_id is None or entry.wallet.user_account_id is None:
        return None
    return entry.wallet.user_account.user_profile


def profile_name(profile) -> str:
    return (profile.full_name or "").strip() or profile.user.email


def entry_identity(entry: WhitelistEntry) -> HolderIdentity:
    if entry.wallet_id is None:
        return HolderIdentity(
            HolderType.TREASURY.value, entry.label or TREASURY_FALLBACK, "", entry.get_status_display()
        )
    holder = _holder(entry)
    name = profile_name(holder) if holder else ""
    if not name:
        return HolderIdentity(HolderType.UNIDENTIFIED.value, "", "", entry.get_status_display())
    return HolderIdentity(
        HolderType.MEMBER.value,
        name,
        (holder.residential_address or "").strip(),
        entry.get_status_display(),
    )


def _ambiguous(entries: list) -> HolderIdentity:
    oldest = min(entries, key=lambda entry: entry.created_at)
    return HolderIdentity(HolderType.AMBIGUOUS.value, AMBIGUOUS_NAME, "", oldest.get_status_display())


def _distinct_addresses(addresses) -> list:
    seen = {}
    for address in addresses:
        candidate = (address or "").strip()
        if candidate:
            seen.setdefault(candidate.lower(), candidate)
    return list(seen.values())


def _entries(keys):
    for start in range(0, len(keys), ADDRESS_CHUNK):
        chunk = keys[start : start + ADDRESS_CHUNK]
        yield from WhitelistEntry.objects.for_addresses(chunk).with_holder_identity()


def identities_for(addresses) -> dict:
    grouped = defaultdict(list)
    for entry in _entries(_distinct_addresses(addresses)):
        grouped[entry.wallet_address.lower()].append(entry)
    return {
        key: (_ambiguous(entries) if len(entries) > 1 else entry_identity(entries[0]))
        for key, entries in grouped.items()
    }


def unnameable_addresses(addresses) -> UnnameableAddresses:
    keys = [address.lower() for address in _distinct_addresses(addresses)]
    identities = identities_for(keys)
    types = [identities.get(key, UNIDENTIFIED).holder_type for key in keys]
    return UnnameableAddresses(types.count(HolderType.AMBIGUOUS.value), types.count(HolderType.UNIDENTIFIED.value))
