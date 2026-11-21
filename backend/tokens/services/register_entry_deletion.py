from collections import defaultdict, deque
from uuid import UUID

from django.apps import apps
from django.db.models import Exists, OuterRef, Q
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability, DeletionScope
from companies.services.company_deletion import (
    CHAIN_FIELDS,
    EXECUTION_MODELS,
    NOT_SUPPORTED,
    chain_unreferenced,
    current_appointment,
    discard,
    follow_ups,
    remove,
    reverse_relations,
    stored_files,
)
from tokens.models import (
    RegisterAllotment,
    RegisterCorrection,
    RegisterEntry,
    RegisterEntryKind,
    RegisterGrant,
    RegisterImport,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterPosition,
    RegisterTransfer,
    ShareRegister,
    ShareToken,
)
from tokens.services.pending_deletion import (
    ALLOTMENT_PARTS,
    PROPOSAL_DECISIONS,
    RECORD_GONE,
)
from tokens.services.register_authority import register_command
from tokens.services.register_events import with_company_event_dates

DELETABLE_KINDS = (RegisterEntryKind.ISSUE, RegisterEntryKind.TRANSFER, RegisterEntryKind.CORRECTION)
SOURCES = (
    (RegisterAllotment, "register_entry"),
    (RegisterGrant, "register_entry"),
    (RegisterTransfer, "register_entry"),
    (RegisterCorrection, "applied_entry"),
)
NO_ENTRY_PREPARER = "A current company administrator or preparer is required to delete this entry."
ENTRIES_ON_CHAIN = "This class has on-chain records, which Ledova keeps, so its entries can't be deleted here."
OPENING_KEPT = "The opening can't be deleted. To start the class again, delete the share class."
COPIED_OPENING_KEPT = "A copied opening correction can't be deleted. Correct the copied opening again instead."
ENTRY_KEPT = "Only an issue, transfer or correction recorded here can be deleted."
CORRECTION_PROPOSED = "A correction proposed for this entry is still on record, so the entry can't be deleted yet."


def _unnotified(data):
    return Q(pk__in=[])


def entries_kept(token):
    if token.status != "draft" or any(getattr(token, field) for field in CHAIN_FIELDS):
        return ENTRIES_ON_CHAIN
    for label in EXECUTION_MODELS:
        model = apps.get_model(label)
        if any(field.name == "token_id" for field in model._meta.fields) and (
            model.objects.filter(token_id=token.pk).exists()
        ):
            return ENTRIES_ON_CHAIN
    return None


def deletable_entries(token, actor, entries):
    if not entries or actor is None or entries_kept(token):
        return set()
    if not ShareToken.objects.register_preparable_by(actor).filter(pk=token.pk).exists():
        return set()
    sourced = Q(pk__in=[])
    for model, field in SOURCES:
        sourced |= Q(Exists(model.objects.filter(**{field: OuterRef("pk")})))
    return set(
        RegisterEntry.objects.filter(pk__in=entries, kind__in=DELETABLE_KINDS)
        .filter(sourced)
        .exclude(Exists(RegisterCorrection.objects.filter(corrects=OuterRef("pk")).exclude(status="applied")))
        .values_list("pk", flat=True)
    )


def _name(entry):
    day = entry.company_event_on or entry.effective_on
    return f"{RegisterEntryKind(entry.kind).label.lower()} of {day.day} {day:%B %Y}"


def _first(entry):
    return f"Delete the {_name(entry)} first."


def _source(entry):
    found = [
        record for model, field in SOURCES for record in model.objects.select_for_update().filter(**{field: entry.pk})
    ]
    if len(found) > 1:
        raise ValidationError(NOT_SUPPORTED)
    return found[0] if found else None


def _records_cessations(token):
    return RegisterImport.objects.filter(token=token, status="applied").exists()


def _blocking(register, entry):
    history = list(with_company_event_dates(RegisterEntry.objects.filter(register=register)).order_by("sequence"))
    ceased = {
        (row.entry_id, row.member_id): row.returned_entry_id
        for row in RegisterMemberCessation.objects.filter(register=register).exclude(entry_id=entry.pk)
    }
    returned = {row.member_id for row in RegisterMemberCessation.objects.filter(returned_entry_id=entry.pk)}
    recorded = _records_cessations(register.token)
    old, new = defaultdict(int), defaultdict(int)
    for row in history:
        for change in row.changes:
            member, delta = UUID(change["member"]), int(change["shares"])
            old_before = old[member]
            old[member] = old_before + delta
            if row.pk == entry.pk:
                continue
            new_before = new[member]
            new[member] = new_before + delta
            if row.sequence < entry.sequence:
                continue
            zeroed, was_zeroed = new_before > 0 and new[member] == 0, old_before > 0 and old[member] == 0
            if (
                new[member] < 0
                or (row.kind == RegisterEntryKind.CESSATION and new[member] != 0)
                or ((row.pk, member) in ceased and not zeroed)
                or (recorded and zeroed and not was_zeroed)
                or (member in returned and new_before == 0 and delta > 0)
            ):
                return row
    for (ceased_at, member), back in ceased.items():
        if back is None or back == entry.pk:
            continue
        balance = 0
        for row in history:
            if row.pk == entry.pk:
                continue
            delta = sum(int(change["shares"]) for change in row.changes if UUID(change["member"]) == member)
            if row.pk == back:
                if balance != 0 or delta <= 0:
                    return row
                break
            balance += delta
    return None


def entry_rows(entry, source):
    model = type(source)
    decision = apps.get_model("tokens", PROPOSAL_DECISIONS[model.__name__])
    rows = {
        RegisterEntry: list(RegisterEntry._base_manager.filter(pk=entry.pk).values()),
        model: list(model._base_manager.filter(pk=source.pk).select_for_update().values()),
    }
    if model is RegisterAllotment:
        for field in ALLOTMENT_PARTS:
            identifier = rows[model][0][f"{field}_id"]
            target = model._meta.get_field(field).related_model
            if identifier:
                rows[target] = list(target._base_manager.filter(pk=identifier).select_for_update().values())
    detached = defaultdict(set)
    queue = deque(owner for owner in rows if owner is not RegisterEntry)
    while queue:
        owner = queue.popleft()
        selected = [row["uuid"] for row in rows[owner]]
        for related in reverse_relations(owner):
            target = related.related_model
            found = list(
                target._base_manager.filter(**{f"{related.field.attname}__in": selected})
                .order_by("pk")
                .select_for_update()
                .values()
            )
            if target is RegisterMemberParticulars and not related.many_to_many:
                for row in found:
                    detached[row["uuid"]].add(related.field.column)
                continue
            known = {row["uuid"] for row in rows.get(target, [])}
            extra = [row for row in found if row["uuid"] not in known]
            if not extra:
                continue
            if related.many_to_many or target is not decision:
                raise ValidationError(NOT_SUPPORTED)
            rows.setdefault(decision, []).extend(extra)
            queue.append(decision)
    handled = {RegisterPosition, RegisterMemberCessation, model}
    for related in reverse_relations(RegisterEntry):
        if related.related_model in handled:
            continue
        if related.related_model._base_manager.filter(**{related.field.attname: entry.pk}).exists():
            raise ValidationError(NOT_SUPPORTED)
    rows[RegisterMemberCessation] = list(
        RegisterMemberCessation._base_manager.filter(entry_id=entry.pk).order_by("pk").select_for_update().values()
    )
    return rows, detached


def delete_register_entry(*, actor, token, entry_id):
    with register_command(actor, token.company_id, "register_entry_delete") as (company, current, _profile, operator):
        appointment, expires_at = current_appointment(
            current, company.pk, operator, [CompanyCapability.ADMIN, CompanyCapability.PREPARE]
        )
        if appointment is None:
            raise NotFound(NO_ENTRY_PREPARER)
        token = ShareToken.objects.select_for_update().filter(pk=token.pk, company=company).first()
        register = ShareRegister.objects.select_for_update().filter(token=token).first() if token else None
        entry = RegisterEntry.objects.filter(pk=entry_id, register=register).first() if register else None
        if entry is None:
            raise NotFound(RECORD_GONE)
        kept = entries_kept(token)
        if kept:
            raise ValidationError(kept)
        if entry.kind == RegisterEntryKind.OPENING:
            raise ValidationError(OPENING_KEPT)
        if entry.kind == RegisterEntryKind.MIRROR_CORRECTION:
            raise ValidationError(COPIED_OPENING_KEPT)
        source = _source(entry) if entry.kind in DELETABLE_KINDS else None
        if source is None:
            raise ValidationError(ENTRY_KEPT)
        correction = with_company_event_dates(RegisterEntry.objects.filter(corrects=entry)).first()
        if correction is not None:
            raise ValidationError(_first(correction))
        if RegisterCorrection.objects.filter(corrects=entry).exists():
            raise ValidationError(CORRECTION_PROPOSED)
        blocking = _blocking(register, entry)
        if blocking is not None:
            raise ValidationError(_first(blocking))
        rows, detached = entry_rows(entry, source)
        chain_unreferenced(rows, ENTRIES_ON_CHAIN)
        files = stored_files(rows)
        remove(
            company_id=company.pk,
            actor_id=current.pk,
            appointment_id=appointment,
            scope=DeletionScope.ENTRY,
            rows=follow_ups(rows, _unnotified),
            detached=detached,
            rechain=register.pk,
            expires_at=expires_at,
        )
    discard(files)
