from django.apps import apps
from django.contrib.admin.models import LogEntry
from django.db import DatabaseError, connections
from django.db.models import Q
from django.utils import timezone
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.exceptions import ValidationError

from companies.models import (
    CompanyAppointment,
    CompanyCapability,
    CompanyDisposal,
    DeletionScope,
)
from companies.services.administration import (
    company_operation,
    lock_company_actor,
    require_company_administration,
)
from shared.db import atomic, current_alias
from shared.services.orphaned_files import _walk
from shared.storage import private_file_fields, private_storage

COMPANY_MODELS = (
    "CompanyActivation",
    "CompanySignupTermsAcceptance",
    "CompanyAppointment",
    "CompanyAuthorityRequest",
    "CompanyTeamInvitation",
    "CompanyLegacyOwnerSource",
)
REGISTER_MODELS = (
    "RegisterMember",
    "ShareRegister",
    "RegisterCorrection",
    "RegisterAgreement",
    "RegisterContribution",
    "RegisterAllotment",
    "RegisterAward",
    "RegisterAwardVesting",
    "RegisterAwardEnd",
    "RegisterAwardVestingReversal",
    "RegisterEvidence",
    "RegisterGrant",
    "RegisterImport",
    "RegisterMemberDocument",
    "RegisterOpening",
    "RegisterParticularsChange",
    "RegisterPersonRegistration",
    "RegisterTransfer",
    "RegisterMemberCessation",
    "MemberInvitation",
    "MemberAssociation",
    "ShareToken",
)
RELATED_MODELS = {
    "companies.CompanyAppointmentRevocation": "appointment__company_id",
    "companies.CompanyAuthorityRequestWithdrawal": "request__company_id",
    "tokens.ClassDetailsRevision": "token__company_id",
    "tokens.ClassRightsRevision": "token__company_id",
    "tokens.RegisterEntry": "register__company_id",
    "tokens.RegisterPosition": "register__company_id",
    "tokens.RegisterReconciliation": "token__company_id",
    "tokens.RegisterAcknowledgement": "reconciliation__token__company_id",
    "tokens.RegisterExport": "token__company_id",
    "tokens.RegisterMemberParticulars": "member__company_id",
    "tokens.ImportedFormerMember": "token__company_id",
    "tokens.MemberAssociationRevocation": "association__company_id",
    **{
        f"tokens.{model}Decision": f"{relation}__company_id"
        for model, relation in (
            ("RegisterCorrection", "register_correction"),
            ("RegisterAllotment", "register_allotment"),
            ("RegisterGrant", "register_grant"),
            ("RegisterImport", "register_import"),
            ("RegisterOpening", "register_opening"),
            ("RegisterParticularsChange", "register_particulars_change"),
            ("RegisterTransfer", "register_transfer"),
        )
    },
}
SCOPES = {
    "companies.Company": "pk",
    **{f"companies.{model}": "company_id" for model in COMPANY_MODELS},
    **{f"tokens.{model}": "company_id" for model in REGISTER_MODELS},
    **RELATED_MODELS,
}
CHAIN_FIELDS = (
    "chain",
    "contract_address",
    "deployment_id",
    "deployment_transaction_id",
    "deployment_tx_hash",
    "deployed_at",
    "former_holders_folded_at",
    "former_holders_block",
)
EXECUTION_MODELS = (
    "tokens.TokenDeployment",
    "tokens.ShareIssuanceExecution",
    "tokens.CapitalIncreaseExecution",
    "tokens.PauseChange",
    "whitelist.WhitelistChange",
)
KEPT_ON_CHAIN = "This company has on-chain records, which Ledova keeps, so it can't be deleted here."
SENDING = "Member notifications are still being sent. Try again in a minute."
EXPIRED = "Your appointment ended before the delete finished, so nothing was deleted."
NOT_SUPPORTED = "Some of this company's records can't be deleted here yet. Contact hello@ledova.io."
DETACHED = "tokens_registermemberparticulars#detach"
NOTIFY = "users.tasks.notifications.send_push_notification"


def chain_free(tokens, company_id, refusal, alias=None):
    if any(token["status"] != "draft" or any(token[field] for field in CHAIN_FIELDS) for token in tokens):
        raise ValidationError(refusal)
    token_ids = [token["uuid"] for token in tokens]
    for label in EXECUTION_MODELS:
        model = apps.get_model(label)
        scope = Q(company_id=company_id) if company_id is not None else Q(pk__in=[])
        if any(field.name == "token_id" for field in model._meta.fields):
            scope |= Q(token_id__in=token_ids)
        if model.objects.using(alias or current_alias()).filter(scope).exists():
            raise ValidationError(refusal)


def chain_unreferenced(rows, refusal, alias=None):
    identifiers = [row[model._meta.pk.attname] for model, records in rows.items() for row in records]
    for label, field in (
        ("blockchain.BlockchainTransaction", "related_uuid"),
        ("blockchain.OutgoingHistoryEvidence", "source_uuid"),
    ):
        model = apps.get_model(label)
        if model.objects.using(alias or current_alias()).filter(**{f"{field}__in": identifiers}).exists():
            raise ValidationError(refusal)


def follow_ups(rows, notified, alias=None):
    alias = alias or current_alias()
    notifications = apps.get_model("users.Notification")
    rows[notifications] = list(
        notifications.objects.using(alias)
        .filter(notified("data"))
        .exclude(pk__in=[row["uuid"] for row in rows.get(notifications, [])])
        .order_by("pk")
        .select_for_update()
        .values()
    )
    audit = Q(pk__in=[])
    for model, records in rows.items():
        if records:
            audit |= Q(
                content_type__app_label=model._meta.app_label,
                content_type__model=model._meta.model_name,
                object_id__in=[str(row[model._meta.pk.attname]) for row in records],
            )
    rows[LogEntry] = list(LogEntry.objects.using(alias).filter(audit).order_by("pk").select_for_update().values())
    try:
        rows[ProcrastinateJob] = list(
            ProcrastinateJob.objects.using(alias)
            .filter(Q(task_name=NOTIFY) & notified("args__data"))
            .order_by("pk")
            .select_for_update(nowait=True)
            .values()
        )
    except DatabaseError as error:
        raise ValidationError(SENDING) from error
    if any(row["status"] == "doing" for row in rows[ProcrastinateJob]):
        raise ValidationError(SENDING)
    return rows


def _company_rows(company):
    if company.operator_wallet_id:
        raise ValidationError(KEPT_ON_CHAIN)
    rows = {
        apps.get_model(label): list(
            apps.get_model(label)
            ._base_manager.filter(**{scope: company.pk})
            .order_by("pk")
            .select_for_update()
            .values()
        )
        for label, scope in SCOPES.items()
    }
    chain_free(rows[apps.get_model("tokens.ShareToken")], company.pk, KEPT_ON_CHAIN)
    chain_unreferenced(rows, KEPT_ON_CHAIN)
    for model, records in rows.items():
        selected = [row[model._meta.pk.attname] for row in records]
        for related in model._meta.related_objects:
            if (
                related.related_model not in rows
                and related.related_model._base_manager.filter(**{f"{related.field.attname}__in": selected}).exists()
            ):
                raise ValidationError(NOT_SUPPORTED)
    associations = [str(row["uuid"]) for row in rows[apps.get_model("tokens.MemberAssociation")]]
    return follow_ups(rows, lambda data: Q(**{f"{data}__record__in": associations}))


def stored_files(rows, prefix=None, alias=None):
    alias = alias or current_alias()
    files = set(_walk(private_storage(), prefix.rstrip("/"))) if prefix else set()
    for model, field in private_file_fields():
        files.update(row[field] for row in rows.get(model, []) if row.get(field))
    kept = set()
    for model, field in private_file_fields():
        selected = [row[model._meta.pk.attname] for row in rows.get(model, [])]
        kept.update(
            model._base_manager.using(alias)
            .filter(**{f"{field}__in": files})
            .exclude(pk__in=selected)
            .values_list(field, flat=True)
        )
    if prefix and kept:
        raise ValidationError(NOT_SUPPORTED)
    return sorted(
        name for name in files - kept if (prefix is None or name.startswith(prefix)) and ".." not in name.split("/")
    )


def remove(*, company_id, actor_id, appointment_id, scope, rows, detached=None, expires_at=None, alias=None):
    alias = alias or current_alias()
    quote = connections[alias].ops.quote_name
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT txid_current()")
        transaction_id = cursor.fetchone()[0]
    manifest = {
        model._meta.db_table: [str(row[model._meta.pk.attname]) for row in records] for model, records in rows.items()
    }
    if detached:
        manifest[DETACHED] = sorted(str(identifier) for identifier in detached)
    receipt = CompanyDisposal.objects.using(alias).create(
        company_id=company_id,
        scope=scope,
        actor_id=actor_id,
        appointment_id=appointment_id,
        manifest=manifest,
        transaction_id=transaction_id,
    )
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT set_config('app.company_disposal', %s, true)", [str(receipt.pk)])
        cursor.execute("SET CONSTRAINTS ALL DEFERRED")
        for identifier, fields in sorted((detached or {}).items()):
            cleared = ", ".join(f"{quote(field)} = NULL" for field in sorted(fields))
            cursor.execute(
                f"UPDATE tokens_registermemberparticulars SET {cleared}, updated_at = clock_timestamp() "
                "WHERE uuid = %s",
                [identifier],
            )
        for model, records in reversed(rows.items()):
            identifiers = [row[model._meta.pk.attname] for row in records]
            if identifiers:
                cursor.execute(
                    f"DELETE FROM {quote(model._meta.db_table)} WHERE {quote(model._meta.pk.column)} = ANY(%s)",
                    [identifiers],
                )
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        cursor.execute("SELECT clock_timestamp()")
        receipt.database_disposed_at = cursor.fetchone()[0]
    if expires_at is not None and expires_at <= receipt.database_disposed_at:
        raise ValidationError(EXPIRED)
    receipt.manifest = {}
    receipt.save(using=alias, update_fields=["database_disposed_at", "manifest", "updated_at"])
    return receipt


def discard(files):
    for name in files:
        try:
            private_storage().delete(name)
        except Exception:
            continue


def current_appointment(actor, company_id, operator, capabilities):
    appointments = CompanyAppointment.objects.current_for(
        actor, company_id, at=timezone.now(), identity_required=operator.issuer_kyc_required
    ).holding_any(capabilities)
    return appointments.order_by("uuid").values_list("pk", "expires_at").first() or (None, None)


def delete_company(*, actor, company_id):
    with company_operation(actor, company_id, "company_delete"), atomic(durable=True):
        company, current_actor, profile, operator = lock_company_actor(actor, company_id)
        require_company_administration(company, current_actor, profile, operator)
        appointment, expires_at = current_appointment(current_actor, company.pk, operator, [CompanyCapability.ADMIN])
        rows = _company_rows(company)
        files = stored_files(rows, prefix=f"companies/{company.pk}/")
        receipt = remove(
            company_id=company.pk,
            actor_id=current_actor.pk,
            appointment_id=appointment,
            scope=DeletionScope.COMPANY,
            rows=rows,
            expires_at=expires_at,
        )
    discard(files)
    return receipt
