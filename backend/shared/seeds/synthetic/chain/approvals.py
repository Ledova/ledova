from uuid import uuid4

from companies.services.authority_requests import _requester_principal
from shared.db import use_operator
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.story import (
    ACCEPTED,
    DRAFT,
    REJECTED,
    SUBMITTED,
    WITHDRAWN,
)
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistChangeStatus,
    WhitelistEntry,
)
from whitelist.services import changes

UNAPPROVED_STATUSES = (DRAFT, SUBMITTED, WITHDRAWN, ACCEPTED)
ENTRY_NOTE = "Synthetic demo entry, approved on the local chain by seed_demo."
TREASURY_NOTE = "Synthetic employee share trust address created by seed_demo; no key is held for it."
NOT_CONFIRMED = "The approval of {address} for {company} ended {status}."


def approved_addresses(plan, company):
    addresses = {}
    for share_class in plan.classes_of(company):
        for position in share_class.positions:
            addresses.setdefault(position.address.lower(), position)
    for item in plan.rounds:
        if plan.share_class(item.share_class).company != company:
            continue
        for application in item.applications:
            lapsed_early = application.status == REJECTED and application.instructed_at is None
            if application.status in UNAPPROVED_STATUSES or lapsed_early:
                continue
            addresses.setdefault(application.address.lower(), application)
    for request in plan.requests:
        if plan.share_class(request.share_class).company == company:
            addresses.setdefault(request.address.lower(), request)
    return sorted(addresses)


def treasury_entries(plan):
    entries = {}
    for treasury in plan.treasuries:
        entry, _ = WhitelistEntry.objects.get_or_create(
            wallet=None, address=treasury.address, defaults={"label": treasury.label, "notes": TREASURY_NOTE}
        )
        entries[treasury.address.lower()] = entry
    return entries


def entry_for(address, records, company):
    holder = records.holders[(company, address)]
    if holder.startswith("treasury:"):
        return records.entries[address], None
    wallet = records.wallet(holder, address)
    entry, created = WhitelistEntry.objects.get_or_create(wallet=wallet, defaults={"notes": ENTRY_NOTE})
    if not created and entry.notes != ENTRY_NOTE:
        WhitelistEntry.objects.filter(pk=entry.pk).update(notes=ENTRY_NOTE)
    return entry, wallet


def approve_company(plan, company_key, records):
    company = records.companies[company_key]
    approved = 0
    for address in approved_addresses(plan, company_key):
        entry, wallet = entry_for(address, records, company_key)
        with use_operator(), _requester_principal(records.operations.pk):
            change = changes.submit(
                uuid4(),
                WhitelistAction.ADD,
                entry.wallet_address,
                records.operations,
                company=company,
                expires_at=None,
                authority=WhitelistAuthority.WHITELIST_ADMIN,
                wallet_uuid=wallet.pk if wallet else None,
            )
        if change.status != WhitelistChangeStatus.CONFIRMED:
            raise ChainStepFailed(NOT_CONFIRMED.format(address=address, company=company.name, status=change.status))
        approved += 1
    return approved
