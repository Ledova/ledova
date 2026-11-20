from django.apps import apps
from django.contrib.admin.models import LogEntry
from django.db import DatabaseError, connections
from django.db.models import Q
from django.utils import timezone
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.exceptions import ValidationError

from companies.models import CompanyAppointment, CompanyCapability, CompanyDisposal
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
NOT_SUPPORTED = "Some of this company's records can't be deleted here yet. Contact hello@ledova.io."


def _rows(company):
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
    tokens = rows[apps.get_model("tokens.ShareToken")]
    if any(token["status"] != "draft" or any(token[field] for field in CHAIN_FIELDS) for token in tokens):
        raise ValidationError(KEPT_ON_CHAIN)
    token_ids = [token["uuid"] for token in tokens]
    for label in EXECUTION_MODELS:
        model = apps.get_model(label)
        scope = Q(company_id=company.pk)
        if any(field.name == "token_id" for field in model._meta.fields):
            scope |= Q(token_id__in=token_ids)
        if model.objects.filter(scope).exists():
            raise ValidationError(KEPT_ON_CHAIN)
    identifiers = [row[model._meta.pk.attname] for model, records in rows.items() for row in records]
    for label, field in (
        ("blockchain.BlockchainTransaction", "related_uuid"),
        ("blockchain.OutgoingHistoryEvidence", "source_uuid"),
    ):
        if apps.get_model(label).objects.filter(**{f"{field}__in": identifiers}).exists():
            raise ValidationError(KEPT_ON_CHAIN)
    for model, records in rows.items():
        selected = [row[model._meta.pk.attname] for row in records]
        for related in model._meta.related_objects:
            if (
                related.related_model not in rows
                and related.related_model._base_manager.filter(**{f"{related.field.attname}__in": selected}).exists()
            ):
                raise ValidationError(NOT_SUPPORTED)
    associations = [str(row["uuid"]) for row in rows[apps.get_model("tokens.MemberAssociation")]]
    notifications = apps.get_model("users.Notification")
    rows[notifications] = list(
        notifications.objects.filter(data__record__in=associations).order_by("pk").select_for_update().values()
    )
    audit = Q(pk__in=[])
    for model, records in rows.items():
        if records:
            audit |= Q(
                content_type__app_label=model._meta.app_label,
                content_type__model=model._meta.model_name,
                object_id__in=[str(row[model._meta.pk.attname]) for row in records],
            )
    rows[LogEntry] = list(LogEntry.objects.filter(audit).order_by("pk").select_for_update().values())
    try:
        rows[ProcrastinateJob] = list(
            ProcrastinateJob.objects.filter(
                task_name="users.tasks.notifications.send_push_notification",
                args__data__record__in=associations,
            )
            .order_by("pk")
            .select_for_update(nowait=True)
            .values()
        )
    except DatabaseError as error:
        raise ValidationError(SENDING) from error
    if any(row["status"] == "doing" for row in rows[ProcrastinateJob]):
        raise ValidationError(SENDING)
    return rows


def _files(company, rows):
    prefix = f"companies/{company.pk}/"
    files = set(_walk(private_storage(), prefix.rstrip("/")))
    for model, field in private_file_fields():
        files.update(row[field] for row in rows.get(model, []) if row.get(field))
    for model, field in private_file_fields():
        selected = [row[model._meta.pk.attname] for row in rows.get(model, [])]
        if model._base_manager.filter(**{f"{field}__in": files}).exclude(pk__in=selected).exists():
            raise ValidationError(NOT_SUPPORTED)
    return sorted(name for name in files if name.startswith(prefix) and ".." not in name.split("/"))


def delete_company(*, actor, company_id):
    with company_operation(actor, company_id, "company_delete"), atomic(durable=True):
        company, current_actor, profile, operator = lock_company_actor(actor, company_id)
        require_company_administration(company, current_actor, profile, operator)
        appointment = (
            CompanyAppointment.objects.current_for(
                current_actor, company.pk, at=timezone.now(), identity_required=operator.issuer_kyc_required
            )
            .filter(capabilities__contains=[CompanyCapability.ADMIN])
            .order_by("uuid")
            .values_list("pk", flat=True)
            .first()
        )
        rows = _rows(company)
        files = _files(company, rows)
        connection = connections[current_alias()]
        with connection.cursor() as cursor:
            cursor.execute("SELECT txid_current()")
            transaction_id = cursor.fetchone()[0]
        receipt = CompanyDisposal.objects.create(
            company_id=company.pk,
            actor=current_actor,
            appointment_id=appointment,
            manifest={
                model._meta.db_table: [str(row[model._meta.pk.attname]) for row in records]
                for model, records in rows.items()
            },
            transaction_id=transaction_id,
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.company_disposal', %s, true)", [str(receipt.pk)])
            cursor.execute("SET CONSTRAINTS ALL DEFERRED")
            for model, records in reversed(rows.items()):
                identifiers = [row[model._meta.pk.attname] for row in records]
                if identifiers:
                    cursor.execute(
                        f"DELETE FROM {connection.ops.quote_name(model._meta.db_table)} "
                        f"WHERE {connection.ops.quote_name(model._meta.pk.column)} = ANY(%s)",
                        [identifiers],
                    )
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("SELECT clock_timestamp()")
            receipt.database_disposed_at = cursor.fetchone()[0]
        receipt.manifest = {}
        receipt.save(update_fields=["database_disposed_at", "manifest", "updated_at"])
    for name in files:
        try:
            private_storage().delete(name)
        except Exception:
            continue
    return receipt
