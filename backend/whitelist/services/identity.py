from collections import defaultdict
from typing import NamedTuple

from whitelist.models import HolderType, WhitelistApproval, WhitelistEntry

TREASURY_FALLBACK = "Operator (treasury/custodian)"
AMBIGUOUS_NAME = "Two wallets share this address"
NOT_APPROVED = "Not approved for this company"
ADDRESS_CHUNK = 500


class HolderIdentity(NamedTuple):

    holder_type: str
    name: str
    residential_address: str
    whitelist_status: str
    user_id: int | None = None


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


def entry_identity(entry: WhitelistEntry, whitelist_status: str = "") -> HolderIdentity:
    if entry.wallet_id is None:
        return HolderIdentity(HolderType.TREASURY.value, entry.label or TREASURY_FALLBACK, "", whitelist_status)
    holder = _holder(entry)
    name = profile_name(holder) if holder else ""
    if not name:
        return HolderIdentity(HolderType.UNIDENTIFIED.value, "", "", whitelist_status)
    return HolderIdentity(
        HolderType.MEMBER.value,
        name,
        (holder.residential_address or "").strip(),
        whitelist_status,
        holder.user_id,
    )


def _ambiguous(entries: list, status_of) -> HolderIdentity:
    oldest = min(entries, key=lambda entry: entry.created_at)
    return HolderIdentity(HolderType.AMBIGUOUS.value, AMBIGUOUS_NAME, "", status_of(oldest))


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


def _approval_statuses(entries, company_id):
    if company_id is None:
        return lambda entry: ""
    approvals = {
        approval.entry_id: approval
        for approval in WhitelistApproval.objects.filter(
            entry_id__in=[entry.pk for entry in entries], company_id=company_id
        )
    }
    return lambda entry: approvals[entry.pk].status_display() if entry.pk in approvals else NOT_APPROVED


def identities_for(addresses, company_id=None) -> dict:
    grouped = defaultdict(list)
    for entry in _entries(_distinct_addresses(addresses)):
        grouped[entry.wallet_address.lower()].append(entry)
    status_of = _approval_statuses([entry for entries in grouped.values() for entry in entries], company_id)
    return {
        key: (_ambiguous(entries, status_of) if len(entries) > 1 else entry_identity(entries[0], status_of(entries[0])))
        for key, entries in grouped.items()
    }


def unnameable_addresses(addresses) -> UnnameableAddresses:
    keys = [address.lower() for address in _distinct_addresses(addresses)]
    identities = identities_for(keys)
    types = [identities.get(key, UNIDENTIFIED).holder_type for key in keys]
    return UnnameableAddresses(types.count(HolderType.AMBIGUOUS.value), types.count(HolderType.UNIDENTIFIED.value))
