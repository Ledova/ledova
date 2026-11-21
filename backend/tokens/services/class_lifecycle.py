from collections import defaultdict, deque

from django.apps import apps
from django.db import connections
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import Company, CompanyCapability, DeletionScope
from companies.services.company_deletion import (
    NOT_SUPPORTED,
    chain_free,
    chain_unreferenced,
    current_appointment,
    discard,
    follow_ups,
    remove,
    reverse_relations,
    stored_files,
)
from shared.db import current_alias
from tokens.exceptions import RegisterChangeConflict
from tokens.models import ShareRegister, ShareToken
from tokens.models.choices import ShareTokenType
from tokens.services.register_authority import register_command
from tokens.services.share_token_service import reserved_symbol

EDIT_DETAILS_BLOCKED_REASON = "Class details can change only while its opening is empty and no dependent records exist."
KEPT_ON_CHAIN = "This class has on-chain records, which Ledova keeps, so it can't be deleted here."
CLASS_RECORDS = (
    "ShareRegister",
    "RegisterEntry",
    "RegisterPosition",
    "RegisterReconciliation",
    "RegisterAcknowledgement",
    "RegisterExport",
    "ImportedFormerMember",
    "ClassDetailsRevision",
    "ClassRightsRevision",
    "RegisterImport",
    "RegisterImportDecision",
    "RegisterOpening",
    "RegisterOpeningDecision",
    "RegisterCorrection",
    "RegisterCorrectionDecision",
    "RegisterGrant",
    "RegisterGrantDecision",
    "RegisterAllotment",
    "RegisterAllotmentDecision",
    "RegisterTransfer",
    "RegisterTransferDecision",
    "RegisterAward",
    "RegisterAwardVesting",
    "RegisterAwardEnd",
    "RegisterAwardVestingReversal",
    "RegisterMemberCessation",
    "RegisterMemberDocument",
)
CHAIN_RECORDS = {
    f"tokens.{name}"
    for name in (
        "CapitalIncreaseRequest",
        "FormerHolder",
        "RegisterCapitalIncrease",
        "RegisterDeployment",
        "RegisterInstruction",
        "RegisterPauseChange",
        "ShareIssuance",
        "ShareIssuanceRequest",
        "SwapOrder",
        "TransferOrder",
    )
}


def class_lifecycle_access(token, actor):
    token.can_edit_details = False
    token.edit_blocked_reason = None
    token.can_delete = False
    token.deletion_blocked_reason = None
    if actor is not None and Company.objects.register_preparable_by(actor).filter(pk=token.company_id).exists():
        token.can_edit_details, token.deletion_blocked_reason = _available(token.pk)
        if not token.can_edit_details:
            token.edit_blocked_reason = EDIT_DETAILS_BLOCKED_REASON
        token.can_delete = token.deletion_blocked_reason is None
    return token


def _available(token_id):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_class_details_available(%s, true), tokens_class_deletion_reason(%s)",
            [token_id, token_id],
        )
        return cursor.fetchone()


def _current(token, actor, expected_updated_at):
    if not Company.objects.register_preparable_by(actor).filter(pk=token.company_id).exists():
        raise NotFound("A current company administrator or preparer is required to change this share class.")
    token = get_object_or_404(ShareToken.objects.select_for_update(), pk=token.pk, company_id=token.company_id)
    list(ShareRegister.objects.select_for_update().filter(token=token).values_list("pk", flat=True))
    if token.updated_at != expected_updated_at:
        raise RegisterChangeConflict("This share class changed. Review its current details before trying again.")
    return token


def update_class_details(*, actor, token, expected_updated_at, changes):
    if set(changes) != {"name", "symbol", "token_type"}:
        raise ValidationError("Supply only the class name, code and type.")
    name, symbol, token_type = (changes[field] for field in ("name", "symbol", "token_type"))
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name) > 100
        or not isinstance(symbol, str)
        or not symbol.isascii()
        or not symbol.isalpha()
        or not 1 <= len(symbol) <= 5
        or reserved_symbol(symbol)
        or token_type not in ShareTokenType.values
    ):
        raise ValidationError("Supply a valid class name, code and type.")
    changes = {"name": name.strip(), "symbol": symbol.upper(), "token_type": token_type}
    with register_command(actor, token.company_id, "register_class_edit") as (_, current_actor, _profile):
        token = _current(token, current_actor, expected_updated_at)
        if not _available(token.pk)[0]:
            raise RegisterChangeConflict(EDIT_DETAILS_BLOCKED_REASON)
        if (
            ShareToken.objects.filter(company_id=token.company_id, symbol=changes["symbol"])
            .exclude(pk=token.pk)
            .exists()
        ):
            raise ValidationError({"symbol": "This class code already exists in the company."})
        for field, value in changes.items():
            setattr(token, field, value)
        token.save(update_fields=["name", "symbol", "token_type", "updated_at"])
        token.refresh_from_db(fields=["updated_at"])
        return class_lifecycle_access(token, current_actor)


def share_class_rows(token, alias=None):
    alias = alias or current_alias()
    allowed = {apps.get_model("tokens", name) for name in CLASS_RECORDS}
    particulars = apps.get_model("tokens", "RegisterMemberParticulars")
    rows = {ShareToken: list(ShareToken._base_manager.using(alias).filter(pk=token.pk).select_for_update().values())}
    detached = defaultdict(set)
    queue = deque([(ShareToken, [token.pk])])
    while queue:
        model, identifiers = queue.popleft()
        for related in reverse_relations(model):
            target = related.related_model
            found = list(
                target._base_manager.using(alias)
                .filter(**{f"{related.field.attname}__in": identifiers})
                .order_by("pk")
                .select_for_update()
                .values()
            )
            if not found:
                continue
            if target is particulars and not related.many_to_many:
                for row in found:
                    detached[row["uuid"]].add(related.field.column)
                continue
            if target not in allowed or related.many_to_many:
                raise ValidationError(KEPT_ON_CHAIN if target._meta.label in CHAIN_RECORDS else NOT_SUPPORTED)
            key = target._meta.pk.attname
            known = {row[key] for row in rows.get(target, [])}
            new = [row for row in found if row[key] not in known]
            if new:
                rows.setdefault(target, []).extend(new)
                queue.append((target, [row[key] for row in new]))
    chain_free(rows[ShareToken], None, KEPT_ON_CHAIN, alias)
    chain_unreferenced(rows, KEPT_ON_CHAIN, alias)
    awards = [str(row["uuid"]) for row in rows.get(apps.get_model("tokens", "RegisterAward"), [])]
    rows = follow_ups(
        rows,
        lambda data: Q(**{f"{data}__token": str(token.pk)}) | Q(**{f"{data}__award__in": awards}),
        alias,
    )
    return rows, detached


def delete_share_class(*, actor, token, expected_updated_at):
    with register_command(actor, token.company_id, "register_class_delete") as (_, current_actor, _profile):
        token = _current(token, current_actor, expected_updated_at)
        reason = _available(token.pk)[1]
        if reason:
            raise RegisterChangeConflict(reason)
        appointment, expires_at = current_appointment(
            current_actor, token.company_id, [CompanyCapability.ADMIN, CompanyCapability.PREPARE]
        )
        rows, detached = share_class_rows(token)
        files = stored_files(rows)
        remove(
            company_id=token.company_id,
            actor_id=current_actor.pk,
            appointment_id=appointment,
            scope=DeletionScope.SHARE_CLASS,
            rows=rows,
            detached=detached,
            expires_at=expires_at,
        )
    discard(files)
