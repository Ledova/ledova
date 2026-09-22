from collections import defaultdict
from contextlib import contextmanager
from datetime import date
from datetime import timezone as utc_zone
from decimal import Decimal

from django.db import connections
from django.db.models import BigIntegerField, CharField, Value

from shared.db import atomic, current_alias
from shared.utils import csv_cell
from tokens.exceptions import RegisterNotInitialized
from tokens.models import (
    ImportedFormerMember,
    RegisterEntry,
    RegisterEntryKind,
    RegisterExport,
    RegisterExportKind,
    RegisterImport,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    RegisterPosition,
    RegisterReconciliation,
    ShareIssuance,
    ShareRegister,
)
from tokens.models.choices import (
    IDENTITY_LABELS,
    IDENTITY_LIVE,
    IDENTITY_NONE,
    IDENTITY_PARTICULARS,
    IDENTITY_RECORDED,
    IDENTITY_STAMPED,
    IDENTITY_TREASURY_LABEL,
    IDENTITY_UNRESOLVABLE,
)
from tokens.services.register_inclusions import waiting_effects
from whitelist.models import HolderType
from whitelist.services.identity import UNIDENTIFIED, identities_for

ZERO = Decimal("0.00")

SOURCE_STORED = "stored"

SOURCE_LABELS = {
    SOURCE_STORED: "Stored register",
}

MEMBER_AMBIGUOUS_NAME = "The member's wallets resolve to different people"
MEMBER_AMBIGUOUS = (HolderType.AMBIGUOUS.value, MEMBER_AMBIGUOUS_NAME, "", IDENTITY_UNRESOLVABLE, None)

EMPTY_ALLOTMENT = {"shares": 0, "entered_on": None, "paid": ZERO, "backed": 0, "unbacked": 0}


IDENTITY_BY_HOLDER_TYPE = {
    HolderType.MEMBER.value: IDENTITY_LIVE,
    HolderType.TREASURY.value: IDENTITY_TREASURY_LABEL,
    HolderType.AMBIGUOUS.value: IDENTITY_UNRESOLVABLE,
    HolderType.UNIDENTIFIED.value: IDENTITY_NONE,
}


def identity_source_label(source, stamped_at) -> str:
    if source != IDENTITY_STAMPED:
        return IDENTITY_LABELS[source]
    return f"Stamped at allotment on {stamped_at.date().isoformat()}"


ISSUED_SUPPLY_ROW = "Issued supply"
LISTED_TOTAL_ROW = "Held by listed members"
WAITING_ROW = "Completed effects waiting to be recorded"
WAITING_UNKNOWN = "unknown"
RECONCILED_ROW = "Reconciled with the chain"
NEVER_RECONCILED = "never"
FORMER_MEMBERS_HEADING = "Former members (retained under s169(3) of the Corporations Act)"
FORMER_MEMBER_HEADERS = [
    "Name",
    "Residential address",
    "Wallet address",
    "Shares held on ceasing",
    "Date ceased",
    "Identity source",
    "Identity recorded at",
]
AS_AT_ROW = "As at"
NEVER_FOLDED = "never read"
STALE = "stale"

REGISTER_HEADERS = [
    "Member ID",
    "Name",
    "Residential address",
    "Wallet addresses",
    "Holder type",
    "Class",
    "Shares held",
    "Percentage of issued supply",
    "Balance source",
    "Identity source",
    "Date entered",
    "Whitelist status",
    "Amount paid",
]

NO_WHITELIST_ENTRY = "No whitelist entry"

API_FIELDS = (
    "member",
    "wallets",
    "name",
    "balance",
    "percentage",
    "source",
    "holder_type",
    "entered_on",
    "share_class",
    "identity_source",
)


def _allotments(token) -> dict:
    grouped = {}
    issuances = ShareIssuance.objects.filter_by_token(token).completed().with_subscription().order_by("created_at")
    for issuance in issuances:
        row = grouped.setdefault(
            issuance.recipient_address, {"shares": 0, "entered_on": None, "paid": ZERO, "backed": 0, "unbacked": 0}
        )
        shares = _amount(issuance)
        row["shares"] += shares
        moment = issuance.completed_at or issuance.created_at
        if row["entered_on"] is None or (moment is not None and moment < row["entered_on"]):
            row["entered_on"] = moment
        backing = _backing(issuance, shares)
        if backing is None:
            row["unbacked"] += 1
        else:
            row["paid"] += backing
            row["backed"] += shares
    return grouped


def _backing(issuance, shares):
    subscription = _subscription(issuance)
    if subscription is None or subscription.allotment_quantity != shares:
        return None
    backing = subscription.money_backing_shares
    return backing if backing > ZERO else None


def _amount_paid(allotment, balance, touched):
    if touched or allotment["unbacked"] or allotment["backed"] != int(balance):
        return None
    return allotment["paid"]


def _amount(issuance) -> int:
    try:
        return int(issuance.amount)
    except (TypeError, ValueError):
        return 0


def _subscription(issuance):
    request = getattr(issuance, "shareissuancerequest", None)
    if request is None:
        return None
    return getattr(request, "subscription", None)


def _merged(allotments):
    merged = dict(EMPTY_ALLOTMENT)
    for allotment in allotments:
        for key in ("shares", "paid", "backed", "unbacked"):
            merged[key] += allotment[key]
        if merged["entered_on"] is None or allotment["entered_on"] < merged["entered_on"]:
            merged["entered_on"] = allotment["entered_on"]
    return merged


def _member_identity(addresses, identities, stamps, recorded=None):
    people = {
        (identity.holder_type, identity.name, identity.residential_address)
        for identity in (identities.get(address.lower(), UNIDENTIFIED) for address in addresses)
        if identity.holder_type != HolderType.UNIDENTIFIED.value
    }
    if len(people) > 1 or any(holder_type == HolderType.AMBIGUOUS.value for holder_type, _, _ in people):
        return MEMBER_AMBIGUOUS
    if people:
        holder_type, name, residential_address = people.pop()
        return holder_type, name, residential_address, IDENTITY_BY_HOLDER_TYPE[holder_type], None
    found = [stamps[address.lower()] for address in addresses if address.lower() in stamps]
    resolved = [stamp for stamp in found if stamp["stamped_at"]]
    if len({(stamp["name"], stamp["residential_address"]) for stamp in resolved}) > 1:
        return MEMBER_AMBIGUOUS
    if resolved:
        stamp = max(resolved, key=lambda stamp: stamp["stamped_at"])
        return (
            HolderType.MEMBER.value,
            stamp["name"],
            stamp["residential_address"],
            IDENTITY_STAMPED,
            stamp["stamped_at"],
        )
    if recorded is not None:
        return HolderType.MEMBER.value, recorded.name, recorded.residential_address, IDENTITY_PARTICULARS, None
    named = next((stamp["name"] for stamp in found if stamp["name"]), "")
    return HolderType.UNIDENTIFIED.value, named, "", IDENTITY_RECORDED if named else IDENTITY_NONE, None


def _allotted(allotment, opened_on, ceased):
    if allotment["entered_on"] is None:
        return None, False
    allotted_on = allotment["entered_on"].astimezone(utc_zone.utc).date()
    return allotted_on, any(allotted_on <= day <= opened_on for day in ceased)


def _entered_on(position, continuous, allotted_on):
    if continuous and allotted_on is not None and allotted_on < position.entered_on:
        return allotted_on
    return position.entered_on


@contextmanager
def _snapshot():
    outermost = not connections[current_alias()].in_atomic_block
    with atomic():
        if outermost:
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        yield


def _history(register):
    entries = RegisterEntry.objects.filter(register=register).order_by("sequence")
    (_, opened_on, opening), *later = entries.values_list("kind", "effective_on", "changes")
    running = {change["member"]: int(change["shares"]) for change in opening}
    transferred = set()
    for kind, _, changes in later:
        for change in changes:
            if kind == RegisterEntryKind.TRANSFER:
                transferred.add(change["member"])
            if change["member"] in running:
                running[change["member"]] += int(change["shares"])
                if not running[change["member"]]:
                    del running[change["member"]]
    return opened_on, set(running), transferred


def _cessations(token, member_of):
    from tokens.services.former_holders import former_members_of

    ceased, former = defaultdict(list), []
    for row in former_members_of(token):
        member = member_of.get(row.wallet_address.lower())
        if member is None:
            former.append(row)
        else:
            ceased[member].append(row)
    return ceased, former


def _imported(token):
    applied = RegisterImport.objects.filter(token=token, status="applied").first()
    if applied is None:
        return -1, {}
    return applied.register_sequence, {row["member"]: row for row in applied.members}


def _stored_register(token):
    register = ShareRegister.objects.filter(token=token).first()
    if register is None or register.sequence == 0:
        return None
    opened_on, held, transferred = _history(register)
    positions = list(
        RegisterPosition.objects.filter(register=register, shares__gt=0)
        .select_related("last_entry")
        .order_by("-shares", "member_id")
    )
    particulars = {
        record.member_id: record
        for record in RegisterMemberParticulars.objects.filter(
            member_id__in=[position.member_id for position in positions]
        )
    }
    imported_at, imported = _imported(token)
    wallets = defaultdict(list)
    for link in RegisterMemberWallet.objects.filter(
        company_id=token.company_id, member_id__in=[position.member_id for position in positions]
    ).order_by("address"):
        wallets[link.member_id].append(link.address)
    ceased, former = _cessations(
        token, {address.lower(): member for member, addresses in wallets.items() for address in addresses}
    )
    identities = identities_for([address for addresses in wallets.values() for address in addresses])
    stamps = ShareIssuance.objects.filter_by_token(token).latest_identity_stamps()
    allotments = {address.lower(): allotment for address, allotment in _allotments(token).items()}
    issued = int(register.issued_supply)
    rows = []
    for position in positions:
        member = str(position.member_id)
        addresses = wallets[position.member_id]
        holder_type, name, residential_address, source, stamped_at = _member_identity(
            addresses, identities, stamps, particulars.get(position.member_id)
        )
        allotment = _merged(allotments[address.lower()] for address in addresses if address.lower() in allotments)
        allotted_on, interrupted = _allotted(
            allotment, opened_on, [row.ceased_on for row in ceased[position.member_id]]
        )
        entered_on = _entered_on(position, member in held and not interrupted, allotted_on)
        former.extend(row for row in ceased[position.member_id] if row.ceased_on < entered_on)
        shares = int(position.shares)
        amount_paid = _amount_paid(allotment, shares, member in transferred or interrupted)
        continuing = imported.get(member) if member in held else None
        if continuing is not None:
            entered_on = date.fromisoformat(continuing["entered_on"])
            if position.last_entry.sequence <= imported_at:
                amount_paid = None if continuing["amount_paid"] is None else Decimal(continuing["amount_paid"])
        rows.append(
            {
                "member": member,
                "wallets": [
                    {
                        "address": address,
                        "whitelist_status": identities.get(address.lower(), UNIDENTIFIED).whitelist_status,
                    }
                    for address in addresses
                ],
                "name": name or None,
                "balance": str(shares),
                "percentage": round(shares / issued * 100, 2) if issued else 0,
                "source": SOURCE_STORED,
                "holder_type": holder_type,
                "holder_type_display": HolderType(holder_type).label,
                "identity_source": identity_source_label(source, stamped_at),
                "entered_on": entered_on,
                "share_class": token.symbol,
                "residential_address": residential_address,
                "amount_paid": amount_paid,
            }
        )
    former.extend(
        ImportedFormerMember.objects.filter(token=token).annotate(
            wallet_address=Value(None, output_field=CharField()),
            ceased_at_block=Value(None, output_field=BigIntegerField()),
            identity_source=Value(IDENTITY_PARTICULARS),
        )
    )
    former.sort(key=lambda row: row.wallet_address or "")
    former.sort(key=lambda row: row.ceased_on, reverse=True)
    return {
        "rows": rows,
        "sequence": register.sequence,
        "issued_supply": issued,
        "waiting_effects": waiting_effects(token.pk),
        "former_members": former,
        "reconciliation": RegisterReconciliation.objects.filter(token=token).first(),
    }


def stored_register(token):
    with _snapshot():
        return _stored_register(token)


def api_holders(rows) -> list[dict]:
    return [{field: row[field] for field in API_FIELDS} for row in rows]


def _summary_rows(register) -> list[list]:
    summary = [
        [ISSUED_SUPPLY_ROW, str(register["issued_supply"])],
        [LISTED_TOTAL_ROW, str(sum(int(row["balance"]) for row in register["rows"]))],
    ]
    if register["waiting_effects"] is None:
        summary.append([WAITING_ROW, WAITING_UNKNOWN])
    elif register["waiting_effects"]:
        summary.append([WAITING_ROW, str(register["waiting_effects"])])
    return summary + [_reconciliation_row(register["reconciliation"])]


def _reconciliation_row(record):
    if record is None:
        return [RECONCILED_ROW, NEVER_RECONCILED]
    count = len(record.discrepancies)
    outcome = f"{count} {'discrepancy' if count == 1 else 'discrepancies'}" if count else record.status
    reached = "" if record.block_number is None else f"block {record.block_number}"
    return [RECONCILED_ROW, outcome, reached, record.created_at.isoformat()]


def export_rows(token, requested_by) -> list[list]:
    register = stored_register(token)
    if register is None:
        raise RegisterNotInitialized()
    former = register["former_members"]
    rows = (
        [_csv_row(row) for row in register["rows"]] + [[]] + _summary_rows(register) + former_member_rows(token, former)
    )
    RegisterExport.objects.create(
        token=token,
        requested_by_id=requested_by.pk,
        kind=RegisterExportKind.REGISTER_CSV,
        register_sequence=register["sequence"],
        member_rows=len(register["rows"]),
        former_rows=len(former),
    )
    return rows


def former_member_rows(token, members) -> list[list]:
    from tokens.services.former_holders import fold_is_stale

    rows = [
        [
            csv_cell(row.name),
            csv_cell(row.residential_address),
            csv_cell(row.wallet_address),
            csv_cell(str(row.shares_at_cessation)),
            csv_cell(row.ceased_on.isoformat()),
            csv_cell(
                "Profile when the cessation was recorded"
                if row.identity_source == IDENTITY_LIVE
                else IDENTITY_LABELS.get(row.identity_source, row.identity_source)
            ),
            csv_cell(row.created_at.isoformat()),
        ]
        for row in members
    ]
    return [[], [FORMER_MEMBERS_HEADING], FORMER_MEMBER_HEADERS, *rows, _as_at_row(token, fold_is_stale(token))]


def _as_at_row(token, stale: bool) -> list:
    if token.former_holders_folded_at is None:
        return [AS_AT_ROW, NEVER_FOLDED, STALE]
    reached = "" if token.former_holders_block is None else f"block {token.former_holders_block}"
    read_at = token.former_holders_folded_at.isoformat()
    return [AS_AT_ROW, read_at, reached, STALE] if stale else [AS_AT_ROW, read_at, reached]


def _csv_row(row) -> list:
    return [
        csv_cell(value)
        for value in (
            row["member"],
            row["name"] or "",
            row["residential_address"],
            "; ".join(wallet["address"] for wallet in row["wallets"]),
            row["holder_type_display"],
            row["share_class"],
            row["balance"],
            f"{row['percentage']}%",
            SOURCE_LABELS[row["source"]],
            row["identity_source"],
            row["entered_on"].isoformat(),
            "; ".join(
                f"{wallet['address']}: {wallet['whitelist_status'] or NO_WHITELIST_ENTRY}" for wallet in row["wallets"]
            ),
            "" if row["amount_paid"] is None else f"{row['amount_paid']:.2f}",
        )
    ]
