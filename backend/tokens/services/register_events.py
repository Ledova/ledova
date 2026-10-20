from datetime import date
from uuid import UUID

from django.db import IntegrityError
from django.db.models.expressions import RawSQL
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from shared.db import APP_ALIAS, atomic, current_alias
from tokens.exceptions import RegisterChangeConflict, RegisterIntegrityError
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareRegister,
    ShareToken,
)


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Register recording and verification require the operator connection.")


def _uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Register references must be UUIDs.") from None


def _changes(changes):
    if not isinstance(changes, list):
        raise ValidationError("Register changes must be a list of member IDs and integer shares.")
    normalized = []
    try:
        for change in changes:
            if not isinstance(change, dict) or set(change) != {"member", "shares"}:
                raise ValueError
            shares = change["shares"]
            if isinstance(shares, bool) or not isinstance(shares, (str, int)) or str(int(shares)) != str(shares):
                raise ValueError
            normalized.append({"member": str(UUID(str(change["member"]))), "shares": str(shares)})
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Register changes require member UUIDs and exact integer shares.") from None
    return sorted(normalized, key=lambda change: change["member"])


def company_event_requirements(proposal, register):
    if proposal.company_event_on is None:
        return ["company_event_date_required"]
    if proposal.company_event_on > timezone.now().date():
        return ["company_event_date_in_future"]
    if RegisterEntry.objects.filter(register=register, effective_on__gt=proposal.company_event_on).exists():
        return ["effective_date_before_latest_entry"]
    return []


def with_company_event_dates(entries):
    return entries.annotate(
        company_event_on=RawSQL("tokens_register_company_event_on(tokens_registerentry)", []),
        company_date_required=RawSQL(
            "EXISTS (SELECT 1 FROM tokens_shareregister register "
            "WHERE register.uuid = tokens_registerentry.register_id "
            "AND ((tokens_registerentry.kind = 'issue' AND ("
            "EXISTS (SELECT 1 FROM tokens_registergrant source WHERE source.uuid = tokens_registerentry.operation_id "
            "AND source.register_entry_id = tokens_registerentry.uuid "
            "AND source.status = 'applied' AND source.company_id = register.company_id "
            "AND source.token_id = register.token_id) "
            "OR EXISTS (SELECT 1 FROM tokens_registerallotment source "
            "WHERE source.uuid = tokens_registerentry.operation_id "
            "AND source.register_entry_id = tokens_registerentry.uuid "
            "AND source.status = 'applied' AND source.company_id = register.company_id "
            "AND source.token_id = register.token_id))) "
            "OR (tokens_registerentry.kind = 'transfer' AND "
            "EXISTS (SELECT 1 FROM tokens_registertransfer source "
            "WHERE source.uuid = tokens_registerentry.operation_id "
            "AND source.register_entry_id = tokens_registerentry.uuid "
            "AND source.status = 'applied' AND source.company_id = register.company_id "
            "AND source.token_id = register.token_id))))",
            [],
        ),
    )


def matching_particulars(held, name, residential_address):
    if (name and name.strip() != held.name) or (
        residential_address and residential_address.strip() != held.residential_address
    ):
        raise ValidationError("An existing member's identity must match the retained particulars.")
    return held.name, held.residential_address


def retained_particulars(company, member, name, residential_address):
    held = (
        RegisterMemberParticulars.objects.select_for_update().filter(member_id=member, member__company=company).first()
    )
    if held is None:
        raise ValidationError("Choose an identified member of this company's register.")
    return matching_particulars(held, name, residential_address)


def create_member(*, company_id, member_id):
    _operator()
    company_id, member_id = _uuid(company_id), _uuid(member_id)
    member, _ = RegisterMember.objects.get_or_create(uuid=member_id, defaults={"company_id": company_id})
    if member.company_id != company_id:
        raise RegisterChangeConflict()
    return member


def open_register(*, token_id, operation_id, changes, effective_on, recorded_by):
    _operator()
    with atomic():
        token = ShareToken.objects.select_for_update().get(pk=token_id)
        register, _ = ShareRegister.objects.get_or_create(token=token, defaults={"company_id": token.company_id})
        return record_entry(
            register_id=register.pk,
            operation_id=operation_id,
            kind=RegisterEntryKind.OPENING,
            changes=changes,
            effective_on=effective_on,
            recorded_by=recorded_by,
        )


def record_entry(*, register_id, operation_id, kind, changes, effective_on, recorded_by, corrects_id=None):
    _operator()
    values = {
        "kind": kind,
        "changes": _changes(changes),
        "effective_on": effective_on,
        "recorded_by_id": recorded_by.pk,
        "corrects_id": _uuid(corrects_id) if corrects_id is not None else None,
    }
    if kind not in RegisterEntryKind.values or type(effective_on) is not date:
        raise ValidationError("Register changes require a known event kind and an effective date.")
    try:
        with atomic():
            register = ShareRegister.objects.select_for_update().get(pk=register_id)
            previous = RegisterEntry.objects.filter(register=register, operation_id=operation_id).first()
            if previous is not None:
                if any(getattr(previous, key) != value for key, value in values.items()):
                    raise RegisterChangeConflict()
                return previous
            if (
                kind in (RegisterEntryKind.ISSUE, RegisterEntryKind.TRANSFER)
                and RegisterEntry.objects.filter(
                    register=register, sequence=register.sequence, effective_on__gt=effective_on
                ).exists()
            ):
                raise ValidationError("An issue or transfer cannot be dated before the register's latest entry.")
            entry = RegisterEntry.objects.create(register=register, operation_id=operation_id, **values)
            entry.refresh_from_db()
            return entry
    except IntegrityError:
        raise RegisterChangeConflict() from None


def verify_register(register_id):
    _operator()
    with atomic():
        register = ShareRegister.objects.select_for_update().get(pk=register_id)
        positions = {}
        previous_hash = "0" * 64
        sequence = 0
        entries = RegisterEntry.objects.filter(register=register).annotate(
            calculated_hash=RawSQL("tokens_register_entry_hash(tokens_registerentry)", []),
            transition_on=RawSQL("tokens_register_transition_on(tokens_registerentry)", []),
        )
        for entry in entries.iterator(chunk_size=100):
            sequence += 1
            if (
                entry.sequence != sequence
                or entry.previous_hash != previous_hash
                or entry.entry_hash != entry.calculated_hash
            ):
                raise RegisterIntegrityError("The register event chain does not verify.")
            previous_hash = entry.entry_hash
            for change in entry.changes:
                member = UUID(change["member"])
                before = positions.get(member, (0, entry.transition_on, None))
                positions[member] = (
                    before[0] + int(change["shares"]),
                    entry.transition_on if before[0] == 0 else before[1],
                    entry.pk,
                )
        stored = {
            row.member_id: (int(row.shares), row.entered_on, row.last_entry_id)
            for row in RegisterPosition.objects.filter(register=register)
        }
        supply = sum(position[0] for position in positions.values())
        if (
            sequence == 0
            or (register.sequence, register.head_hash, int(register.issued_supply)) != (sequence, previous_hash, supply)
            or stored != positions
        ):
            raise RegisterIntegrityError("The stored holdings or register head differ from the event history.")
        return {
            "register": str(register.pk),
            "token": str(register.token_id),
            "entries": sequence,
            "members": sum(position[0] > 0 for position in positions.values()),
            "issued_supply": str(supply),
            "head_hash": previous_hash,
        }
