import csv
import hashlib
import io
from calendar import monthrange
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, timedelta
from datetime import timezone as utc_zone
from decimal import Decimal
from uuid import UUID

from django.db import connections
from django.db.models import (
    BigIntegerField,
    CharField,
    Exists,
    OuterRef,
    Subquery,
    Value,
)
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.models import CompanyType
from shared.db import atomic, current_alias
from shared.utils import csv_cell
from tokens.constants import (
    CERTIFICATE_MARGIN,
    INSPECTION_COPY_DAYS,
    ISSUE_CERTIFICATE_MONTHS,
    NOTICE_FIGURES_DAYS,
    STATUTORY_CALENDAR,
    TRANSFER_CERTIFICATE_MONTHS,
)
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
    SwapOrder,
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
from tokens.services.register_inclusions import (
    opened_by_import,
    waiting_effects,
    waiting_list,
)
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
NOT_ON_CHAIN = "not on chain"
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
INSPECTION_COPY_HEADING = "Inspection copy under s173(3) of the Corporations Act"
REQUESTED_ON_ROW = "Requested on"
INSTRUCTION_ROW = "Company's written instruction"
RECIPIENT_ROW = "Recipient"
PRODUCED_ON_ROW = "Produced on"
LATE_ROW = f"Produced more than {INSPECTION_COPY_DAYS} days after the request"
NOTICE_FIGURES_HEADING = (
    "Figures for the company's notices of share issues and of changes to members and share structure"
)
SHARE_CLASS_ROW = "Share class"
PERIOD_FROM_ROW = "Period from"
HEAD_ROW = "To register entry"
PERIOD_ENTRIES_HEADING = "Entries in the period"
PERIOD_ENTRY_HEADERS = [
    "Entry",
    "Kind",
    "Effective date",
    "Corrects entry",
    "Member ID",
    "Name",
    "Shares",
    "Amount paid",
]
CLASS_HEADING = "Class at the register head"
MEMBERS_HOLDING_ROW = "Members holding shares"
TOTAL_PAID_ROW = "Total amount paid"
CHANGED_MEMBERS_HEADING = "Members changed in the period, at the register head"
CHANGED_MEMBER_HEADERS = ["Member ID", "Name", "Residential address", "Shares held", "Amount paid"]
NOT_RECORDED = "not recorded"
NOTICE_ENTRY_KINDS = (RegisterEntryKind.ISSUE, RegisterEntryKind.TRANSFER, RegisterEntryKind.CORRECTION)
CERTIFICATE_ENTRY_KINDS = (RegisterEntryKind.ISSUE, RegisterEntryKind.TRANSFER)

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


def _identity_sources(token, member_ids):
    particulars = {
        record.member_id: record for record in RegisterMemberParticulars.objects.filter(member_id__in=member_ids)
    }
    wallets = defaultdict(list)
    for link in RegisterMemberWallet.objects.filter(company_id=token.company_id, member_id__in=member_ids).order_by(
        "address"
    ):
        wallets[link.member_id].append(link.address)
    identities = identities_for(
        [address for addresses in wallets.values() for address in addresses], company_id=token.company_id
    )
    stamps = ShareIssuance.objects.filter_by_token(token).latest_identity_stamps()
    return particulars, wallets, identities, stamps


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
    particulars, wallets, identities, stamps = _identity_sources(token, [position.member_id for position in positions])
    imported_at, imported = _imported(token)
    ceased, former = _cessations(
        token, {address.lower(): member for member, addresses in wallets.items() for address in addresses}
    )
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
        "on_chain": not opened_by_import(token.pk),
    }


def stored_register(token):
    with _snapshot():
        return _stored_register(token)


def stored_waiting_list(token):
    with _snapshot():
        return waiting_list(token.pk)


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
    return summary + [_reconciliation_row(register["reconciliation"], register["on_chain"])]


def _reconciliation_row(record, on_chain):
    if record is None:
        return [RECONCILED_ROW, NEVER_RECONCILED if on_chain else NOT_ON_CHAIN]
    count = len(record.discrepancies)
    outcome = f"{count} {'discrepancy' if count == 1 else 'discrepancies'}" if count else record.status
    reached = "" if record.block_number is None else f"block {record.block_number}"
    return [RECONCILED_ROW, outcome, reached, record.created_at.isoformat()]


def _opened_register(token):
    register = stored_register(token)
    if register is None:
        raise RegisterNotInitialized()
    return register


def _sheet(token, register) -> list[list]:
    return (
        [_csv_row(row) for row in register["rows"]]
        + [[]]
        + _summary_rows(register)
        + former_member_rows(token, register["former_members"], register["on_chain"])
    )


def _record_export(token, requested_by, register, kind, **request):
    RegisterExport.objects.create(
        token=token,
        requested_by_id=requested_by.pk,
        kind=kind,
        register_sequence=register["sequence"],
        member_rows=len(register["rows"]),
        former_rows=len(register["former_members"]),
        **request,
    )


def export_rows(token, requested_by) -> list[list]:
    register = _opened_register(token)
    rows = _sheet(token, register)
    _record_export(token, requested_by, register, RegisterExportKind.REGISTER_CSV)
    return rows


def prepare_inspection_copy(token, requested_by, *, instruction, requested_on, recipient) -> bytes:
    produced_on = timezone.localdate(timezone=STATUTORY_CALENDAR)
    if requested_on > produced_on:
        raise ValidationError("The request date cannot be in the future.")
    register = _opened_register(token)
    late = produced_on - requested_on > timedelta(days=INSPECTION_COPY_DAYS)
    sheet = io.StringIO()
    csv.writer(sheet).writerows(
        [
            REGISTER_HEADERS,
            *_sheet(token, register),
            [],
            [INSPECTION_COPY_HEADING],
            [REQUESTED_ON_ROW, requested_on.isoformat()],
            [INSTRUCTION_ROW, csv_cell(instruction)],
            [RECIPIENT_ROW, csv_cell(recipient)],
            [PRODUCED_ON_ROW, produced_on.isoformat()],
            [LATE_ROW, "yes" if late else "no"],
        ]
    )
    content = sheet.getvalue().encode()
    _record_export(
        token,
        requested_by,
        register,
        RegisterExportKind.INSPECTION_COPY,
        digest=hashlib.sha256(content).hexdigest(),
        instruction=instruction,
        requested_on=requested_on,
        recipient=recipient,
        late=late,
    )
    return content


def _holdings_after(entry, members) -> dict:
    held = dict.fromkeys(members, 0)
    for changes in RegisterEntry.objects.filter(
        register_id=entry.register_id, sequence__lte=entry.sequence
    ).values_list("changes", flat=True):
        for change in changes:
            member = UUID(change["member"])
            if member in held:
                held[member] += int(change["shares"])
    return held


def _certificate_pages(token, entry) -> list[dict]:
    moved = {UUID(change["member"]): int(change["shares"]) for change in entry.changes}
    held = _holdings_after(entry, moved)
    parties = [(member, shares, False) for member, shares in moved.items() if shares > 0]
    parties += [(member, held[member], True) for member, shares in moved.items() if shares < 0 and held[member]]
    particulars, wallets, identities, stamps = _identity_sources(token, [member for member, _, _ in parties])
    pages = []
    for index, (member, shares, balance) in enumerate(parties, 1):
        number = f"{entry.sequence}-{index}"
        holder_type, name, residential_address, _, _ = _member_identity(
            wallets[member], identities, stamps, particulars.get(member)
        )
        if holder_type == HolderType.AMBIGUOUS.value:
            raise ValidationError(
                f"Certificate {number} cannot be prepared: member {member}'s wallets resolve to different people."
            )
        if not name.strip() or not residential_address.strip():
            raise ValidationError(
                f"Certificate {number} cannot be prepared: member {member} is not identified by a name and "
                "residential address."
            )
        pages.append(
            {
                "number": number,
                "name": name,
                "residential_address": residential_address,
                "shares": shares,
                "holding": held[member],
                "balance": balance,
            }
        )
    return pages


def _certificate_pdf(token, entry, pages) -> bytes:
    import pymupdf

    with pymupdf.open() as document:
        for page in pages:
            sheet = document.new_page()
            sheet.insert_htmlbox(
                sheet.rect + (CERTIFICATE_MARGIN, CERTIFICATE_MARGIN, -CERTIFICATE_MARGIN, -CERTIFICATE_MARGIN),
                render_to_string(
                    "tokens/share_certificate.html",
                    {"company": token.company, "token": token, "entry": entry, **page},
                ),
            )
        document.subset_fonts()
        document.set_metadata({})
        return document.tobytes(garbage=3, deflate=True, no_new_id=True)


def prepare_certificate(token, requested_by, *, sequence, instruction) -> bytes:
    with _snapshot():
        entry = RegisterEntry.objects.filter(register__token=token, sequence=sequence).first()
        if entry is None:
            raise ValidationError(f"This share class's register has no entry {sequence}.")
        if entry.kind not in CERTIFICATE_ENTRY_KINDS:
            raise ValidationError(f"Entry {sequence} is not an issue or a transfer, so it has no certificate.")
        reversed_by = RegisterEntry.objects.filter(corrects=entry).values_list("sequence", flat=True).first()
        if reversed_by is not None:
            raise ValidationError(
                f"Entry {sequence} was reversed by correction entry {reversed_by}, so it has no certificate."
            )
        pages = _certificate_pages(token, entry)
        content = _certificate_pdf(token, entry, pages)
    RegisterExport.objects.create(
        token=token,
        requested_by_id=requested_by.pk,
        kind=RegisterExportKind.CERTIFICATE,
        register_sequence=entry.sequence,
        member_rows=len(pages),
        former_rows=0,
        digest=hashlib.sha256(content).hexdigest(),
        instruction=instruction,
    )
    return content


def _paid_or_not_recorded(amount) -> str:
    return NOT_RECORDED if amount is None else f"{amount:.2f}"


def _period_entry_rows(entry, people, issuances) -> list[list]:
    corrects = "" if entry.corrects_id is None else entry.corrects.sequence
    rows = []
    for change in entry.changes:
        member, shares = UUID(change["member"]), int(change["shares"])
        paid = ""
        if entry.kind == RegisterEntryKind.ISSUE:
            issuance = issuances.get(entry.operation_id)
            paid = _paid_or_not_recorded(None if issuance is None else _backing(issuance, shares))
        rows.append(
            [
                entry.sequence,
                entry.get_kind_display(),
                entry.effective_on.isoformat(),
                corrects,
                member,
                people[member][1],
                shares,
                paid,
            ]
        )
    return rows


def _changed_member_row(member, person, current) -> list:
    _, name, residential_address, _, _ = person
    if current is None:
        return [member, name, residential_address, 0, NOT_RECORDED]
    return [member, name, residential_address, current["balance"], _paid_or_not_recorded(current["amount_paid"])]


def prepare_notice_figures(token, requested_by, *, period_from, instruction) -> tuple[bytes, int]:
    produced_on = timezone.localdate(timezone=STATUTORY_CALENDAR)
    if period_from > produced_on:
        raise ValidationError("The period cannot start in the future.")
    with _snapshot():
        register = _stored_register(token)
        if register is None:
            raise RegisterNotInitialized()
        entries = list(
            RegisterEntry.objects.filter(
                register__token=token, kind__in=NOTICE_ENTRY_KINDS, effective_on__gte=period_from
            )
            .select_related("corrects")
            .order_by("sequence")
        )
        changed = sorted({UUID(change["member"]) for entry in entries for change in entry.changes})
        particulars, wallets, identities, stamps = _identity_sources(token, changed)
        people = {
            member: _member_identity(wallets[member], identities, stamps, particulars.get(member)) for member in changed
        }
        issuances = (
            ShareIssuance.objects.filter_by_token(token)
            .completed()
            .with_subscription()
            .in_bulk([entry.operation_id for entry in entries if entry.kind == RegisterEntryKind.ISSUE])
        )
        current = {UUID(row["member"]): row for row in register["rows"]}
        paid = [row["amount_paid"] for row in register["rows"]]
        rows = [
            [NOTICE_FIGURES_HEADING],
            [SHARE_CLASS_ROW, f"{token.name} ({token.symbol})"],
            [PERIOD_FROM_ROW, period_from.isoformat()],
            [HEAD_ROW, register["sequence"]],
            [INSTRUCTION_ROW, instruction],
            [PRODUCED_ON_ROW, produced_on.isoformat()],
            [],
            [PERIOD_ENTRIES_HEADING],
            PERIOD_ENTRY_HEADERS,
            *(row for entry in entries for row in _period_entry_rows(entry, people, issuances)),
            [],
            [CLASS_HEADING],
            [ISSUED_SUPPLY_ROW, register["issued_supply"]],
            [MEMBERS_HOLDING_ROW, len(register["rows"])],
            [TOTAL_PAID_ROW, _paid_or_not_recorded(None if None in paid else sum(paid, ZERO))],
            [],
            [CHANGED_MEMBERS_HEADING],
            CHANGED_MEMBER_HEADERS,
            *(_changed_member_row(member, people[member], current.get(member)) for member in changed),
        ]
    sheet = io.StringIO()
    csv.writer(sheet).writerows([value if isinstance(value, int) else csv_cell(value) for value in row] for row in rows)
    content = sheet.getvalue().encode()
    RegisterExport.objects.create(
        token=token,
        requested_by_id=requested_by.pk,
        kind=RegisterExportKind.NOTICE_FIGURES,
        register_sequence=register["sequence"],
        member_rows=len(changed),
        former_rows=0,
        digest=hashlib.sha256(content).hexdigest(),
        instruction=instruction,
        period_from=period_from,
    )
    return content, register["sequence"]


def months_after(day, months) -> date:
    year, month = divmod(day.year * 12 + day.month - 1 + months, 12)
    return date(year, month + 1, min(day.day, monthrange(year, month + 1)[1]))


def _certificate_due_on(entry) -> date:
    if entry.kind == RegisterEntryKind.ISSUE:
        return months_after(entry.effective_on, ISSUE_CERTIFICATE_MONTHS)
    return months_after(entry.ordered_at.astimezone(STATUTORY_CALENDAR).date(), TRANSFER_CERTIFICATE_MONTHS)


def _outputs_of(entry) -> list[tuple]:
    outputs = []
    if not entry.certified:
        outputs.append((RegisterExportKind.CERTIFICATE, _certificate_due_on(entry)))
    if not entry.noticed and (
        entry.kind == RegisterEntryKind.ISSUE or entry.register.token.company.company_type == CompanyType.PROPRIETARY
    ):
        outputs.append((RegisterExportKind.NOTICE_FIGURES, entry.effective_on + timedelta(days=NOTICE_FIGURES_DAYS)))
    return outputs


def outputs_due() -> list[dict]:
    today = timezone.localdate(timezone=STATUTORY_CALENDAR)
    exports = RegisterExport.objects.filter(token_id=OuterRef("register__token_id"))
    with _snapshot():
        entries = list(
            RegisterEntry.objects.filter(kind__in=CERTIFICATE_ENTRY_KINDS, correction__isnull=True)
            .annotate(
                certified=Exists(
                    exports.filter(kind=RegisterExportKind.CERTIFICATE, register_sequence=OuterRef("sequence"))
                ),
                noticed=Exists(
                    exports.filter(
                        kind=RegisterExportKind.NOTICE_FIGURES,
                        period_from__lte=OuterRef("effective_on"),
                        register_sequence__gte=OuterRef("sequence"),
                    )
                ),
                ordered_at=Subquery(SwapOrder.objects.filter(pk=OuterRef("operation_id")).values("created_at")),
            )
            .exclude(certified=True, noticed=True)
            .select_related("register__token__company")
        )
    due = [
        {
            "token": entry.register.token,
            "sequence": entry.sequence,
            "kind": RegisterEntryKind(entry.kind),
            "effective_on": entry.effective_on,
            "output": output,
            "due_on": due_on,
            "overdue": due_on < today,
        }
        for entry in entries
        for output, due_on in _outputs_of(entry)
    ]
    return sorted(
        due, key=lambda item: (item["due_on"], item["token"].company.name, item["token"].symbol, item["sequence"])
    )


def former_member_rows(token, members, on_chain) -> list[list]:
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
    return [
        [],
        [FORMER_MEMBERS_HEADING],
        FORMER_MEMBER_HEADERS,
        *rows,
        _as_at_row(token, fold_is_stale(token), on_chain),
    ]


def _as_at_row(token, stale: bool, on_chain: bool) -> list:
    if token.former_holders_folded_at is None:
        return [AS_AT_ROW, NEVER_FOLDED, STALE] if on_chain else [AS_AT_ROW, NOT_ON_CHAIN]
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
