import hashlib
import json
import re
from zipfile import BadZipFile, ZipFile

from django.apps import apps
from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from procrastinate.contrib.django.models import ProcrastinateJob

from companies.models import Company, CompanyDisposal
from shared.db import atomic, current_alias, use_migrate
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
OPAQUE_REFERENCE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{1,254}\Z")


def _connection():
    connection = connections[current_alias()]
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT current_user")
        role = cursor.fetchone()[0]
    if connection.vendor != "postgresql" or role != settings.RLS_ROLES["migrate"]:
        raise ValueError("Company disposal requires the separate schema-maintenance credential.")
    return connection


def _reference(value):
    if not OPAQUE_REFERENCE.fullmatch(value):
        raise ValueError("Use an opaque review reference, without names, email addresses or free text.")
    return value


def _pack(path, company, rows):
    tokens = rows[apps.get_model("tokens.ShareToken")]
    if not tokens:
        if path:
            raise ValueError("This company has no share classes; review handover of its basic details separately.")
        return ""
    if not path:
        raise ValueError("Provide the delivered company pack with --pack.")
    try:
        with ZipFile(path) as bundle:
            if bundle.getinfo("manifest.json").file_size > 8 * 1024 * 1024:
                raise ValueError("Company pack manifest is too large for this maintenance command.")
            content = bundle.read("manifest.json")
            manifest = json.loads(content)
            listed = {entry["path"]: entry for entry in manifest["files"]}
            if (
                manifest["format"] != "ledova-company-pack"
                or manifest["version"] != 1
                or manifest["company"]["uuid"] != str(company.pk)
                or len(listed) != len(manifest["files"])
                or set(bundle.namelist()) != {*listed, "manifest.json"}
                or len(bundle.namelist()) != len(listed) + 1
                or sum(entry["size"] for entry in listed.values()) > 320 * 1024 * 1024
            ):
                raise ValueError("Provide a complete company pack for this exact company.")
            for name, entry in listed.items():
                digest, size = hashlib.sha256(), 0
                with bundle.open(name) as source:
                    while block := source.read(65536):
                        size += len(block)
                        if size > entry["size"]:
                            raise ValueError("Company pack contents differ from their manifest.")
                        digest.update(block)
                if size != entry["size"] or digest.hexdigest() != entry["sha256"]:
                    raise ValueError("Company pack contents differ from their manifest.")
    except (BadZipFile, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Provide an intact company pack and its original manifest.") from error
    digest = hashlib.sha256(content).hexdigest()
    exported_at = parse_datetime(manifest["as_at"])
    if exported_at is None or timezone.is_naive(exported_at) or exported_at > timezone.now():
        raise ValueError("The company pack has no valid capture time.")
    registers = {str(row["token_id"]): row for row in rows[apps.get_model("tokens.ShareRegister")]}
    captured = {row["class"]: row for row in manifest["registers"]}
    if set(captured) != {str(token["uuid"]) for token in tokens}:
        raise ValueError("The company pack does not contain every current share class.")
    exports = rows[apps.get_model("tokens.RegisterExport")]
    for token in tokens:
        key = str(token["uuid"])
        register = registers.get(key)
        if register and (captured[key]["sequence"], captured[key]["head_hash"]) != (
            register["sequence"],
            register["head_hash"],
        ):
            raise ValueError("Company records changed after this pack; export and deliver a new one.")
        if not any(
            str(row["token_id"]) == key and row["kind"] == "company_pack" and row["digest"] == digest for row in exports
        ):
            raise ValueError("The delivered pack has no matching recorded export for every class.")
    for model, records in rows.items():
        if model._meta.label == "tokens.RegisterExport":
            continue
        if any(row.get("updated_at", exported_at) > exported_at for row in records):
            raise ValueError("Company records changed after this pack; export and deliver a new one.")
    return digest


def _authority(company_id, appointment_id):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT capabilities @> '[\"admin\"]'::jsonb AND companies_current_team_appointment(uuid, company_id), "
            "expires_at "
            "FROM companies_companyappointment WHERE uuid = %s AND company_id = %s FOR UPDATE",
            [appointment_id, company_id],
        )
        authority = cursor.fetchone()
    if not authority or not authority[0]:
        raise ValueError("Verified company instruction must name a current company administrator appointment.")
    return authority[1]


def _snapshot(company_id, appointment_id, pack):
    _connection()
    company = Company.objects.select_for_update().get(pk=company_id)
    _authority(company_id, appointment_id)
    if company.operator_wallet_id:
        raise ValueError("Retained wallet or chain records require a separate disposal assessment.")
    rows = {
        apps.get_model(label): list(
            apps.get_model(label).objects.filter(**{scope: company_id}).order_by("pk").select_for_update().values()
        )
        for label, scope in SCOPES.items()
    }
    for token in rows[apps.get_model("tokens.ShareToken")]:
        if (
            any(
                token[field]
                for field in (
                    "chain",
                    "contract_address",
                    "deployment_id",
                    "deployment_transaction_id",
                    "deployment_tx_hash",
                    "deployed_at",
                    "former_holders_folded_at",
                    "former_holders_block",
                )
            )
            or token["status"] != "draft"
        ):
            raise ValueError("Retained wallet or chain records require a separate disposal assessment.")
    token_ids = [row["uuid"] for row in rows[apps.get_model("tokens.ShareToken")]]
    for label in (
        "tokens.TokenDeployment",
        "tokens.ShareIssuanceExecution",
        "tokens.CapitalIncreaseExecution",
        "tokens.PauseChange",
        "whitelist.WhitelistChange",
    ):
        model = apps.get_model(label)
        scope = Q(company_id=company_id)
        if any(field.name == "token_id" for field in model._meta.fields):
            scope |= Q(token_id__in=token_ids)
        if model.objects.filter(scope).exists():
            raise ValueError(f"Retained execution history requires separate assessment: {label}.")
    identifiers = [row[model._meta.pk.attname] for model, records in rows.items() for row in records]
    for label, field in (
        ("blockchain.BlockchainTransaction", "related_uuid"),
        ("blockchain.OutgoingHistoryEvidence", "source_uuid"),
    ):
        if apps.get_model(label).objects.filter(**{f"{field}__in": identifiers}).exists():
            raise ValueError(f"Retained execution history requires separate assessment: {label}.")
    for model, records in rows.items():
        identifiers = [row[model._meta.pk.attname] for row in records]
        for related in model._meta.related_objects:
            if (
                related.related_model not in rows
                and related.related_model._base_manager.filter(**{f"{related.field.attname}__in": identifiers}).exists()
            ):
                raise ValueError(f"Unsupported retained relationship: {related.related_model._meta.label}.")
    export_digest = _pack(pack, company, rows)
    associations = [str(row["uuid"]) for row in rows[apps.get_model("tokens.MemberAssociation")]]
    notifications = apps.get_model("users.Notification")
    rows[notifications] = list(
        notifications.objects.filter(data__record__in=associations).order_by("pk").select_for_update().values()
    )
    audit_scope = Q(pk__in=[])
    for model, records in rows.items():
        if records:
            audit_scope |= Q(
                content_type__app_label=model._meta.app_label,
                content_type__model=model._meta.model_name,
                object_id__in=[str(row[model._meta.pk.attname]) for row in records],
            )
    rows[LogEntry] = list(LogEntry.objects.filter(audit_scope).order_by("pk").select_for_update().values())
    rows[ProcrastinateJob] = list(
        ProcrastinateJob.objects.filter(
            task_name="users.tasks.notifications.send_push_notification",
            args__data__record__in=associations,
        )
        .order_by("pk")
        .select_for_update(nowait=True)
        .values()
    )
    if any(row["status"] == "doing" for row in rows[ProcrastinateJob]):
        raise ValueError("Wait for this company's running member notifications to finish before disposal.")
    files = set(_walk(private_storage(), f"companies/{company.pk}"))
    for model, field in private_file_fields():
        files.update(row[field] for row in rows.get(model, []) if row.get(field))
    prefix = f"companies/{company.pk}/"
    if any(not name.startswith(prefix) or ".." in name.split("/") for name in files):
        raise ValueError("A retained file is outside this company's private storage prefix.")
    for model, field in private_file_fields():
        selected = [row[model._meta.pk.attname] for row in rows.get(model, [])]
        if model._base_manager.filter(**{f"{field}__in": files}).exclude(pk__in=selected).exists():
            raise ValueError("A private file is still referenced outside the reviewed company scope.")
    state = {model._meta.db_table: records for model, records in rows.items()}
    digest = hashlib.sha256(
        json.dumps(
            {"rows": state, "files": sorted(files), "appointment": str(appointment_id), "export": export_digest},
            sort_keys=True,
            cls=DjangoJSONEncoder,
        ).encode()
    ).hexdigest()
    return rows, sorted(files), digest, export_digest


def preview_company_disposal(*, company_id, appointment_id, pack=None):
    with use_migrate(), atomic(durable=True):
        rows, files, digest, export_digest = _snapshot(company_id, appointment_id, pack)
        return {
            "company": str(company_id),
            "digest": digest,
            "export_digest": export_digest,
            "rows": {model._meta.db_table: len(records) for model, records in rows.items()},
            "files": len(files),
        }


def dispose_company(
    *,
    company_id,
    appointment_id,
    digest,
    authorisation_reference,
    handover_reference,
    purpose_review_reference,
    pack=None,
):
    references = [
        _reference(value) for value in (authorisation_reference, handover_reference, purpose_review_reference)
    ]
    with use_migrate(), atomic(durable=True):
        rows, files, current_digest, export_digest = _snapshot(company_id, appointment_id, pack)
        if current_digest != digest:
            raise ValueError("The company-exit preview is stale; review a fresh preview before disposal.")
        connection = _connection()
        expires_at = _authority(company_id, appointment_id)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT txid_current()")
            transaction_id = cursor.fetchone()[0]
        receipt = CompanyDisposal.objects.create(
            company_id=company_id,
            manifest={
                model._meta.db_table: [str(row[model._meta.pk.attname]) for row in records]
                for model, records in rows.items()
            },
            digest=digest,
            authorisation_reference=references[0],
            export_digest=export_digest,
            handover_reference=references[1],
            purpose_review_reference=references[2],
            transaction_id=transaction_id,
            pending_files=files,
        )
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.company_disposal', %s, true), set_config('app.company_id', %s, true)",
                [str(receipt.pk), str(company_id)],
            )
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
            disposed_at = cursor.fetchone()[0]
        if expires_at is not None and expires_at <= disposed_at:
            raise ValueError("The administrator appointment expired before disposal completed; nothing was removed.")
        receipt.database_disposed_at = disposed_at
        receipt.manifest = {}
        receipt.save(update_fields=["database_disposed_at", "manifest", "updated_at"])
    try:
        return complete_company_disposal(receipt.pk)
    except Exception as error:
        raise ValueError(
            f"Database disposal committed; file cleanup is unconfirmed. Check status for receipt {receipt.pk}."
        ) from error


def complete_company_disposal(receipt_id):
    with use_migrate(), atomic(durable=True):
        _connection()
        receipt = CompanyDisposal.objects.select_for_update().get(pk=receipt_id)
        if not receipt.database_disposed_at:
            raise ValueError("Company database disposal has not committed.")
        if Company.objects.filter(pk=receipt.company_id).exists():
            raise ValueError("A company currently uses this identifier; do not remove its files.")
        prefix = f"companies/{receipt.company_id}/"
        files = sorted(set(receipt.pending_files) | set(_walk(private_storage(), prefix.rstrip("/"))))
        if any(not name.startswith(prefix) or ".." in name.split("/") for name in files):
            raise ValueError("A pending file is outside the reviewed company scope.")
        pending = []
        for name in files:
            try:
                private_storage().delete(name)
                if private_storage().exists(name):
                    pending.append(name)
            except Exception:
                pending.append(name)
        receipt.pending_files = pending
        receipt.completed_at = None if pending else timezone.now()
        receipt.save(update_fields=["pending_files", "completed_at", "updated_at"])
        return receipt
