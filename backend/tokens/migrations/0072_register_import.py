import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_import

UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
DATE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
WHOLE = "^[1-9][0-9]{0,77}$"
MONEY = "^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$"
MEMBER_KEYS = "ARRAY['amount_paid', 'entered_on', 'member', 'name', 'residential_address', 'shares']"
FORMER_KEYS = "ARRAY['ceased_on', 'name', 'residential_address', 'shares']"


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(
        schema_editor, ["tokens_registerimport", "tokens_registermemberparticulars", "tokens_importedformermember"]
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"""
CREATE FUNCTION tokens_guard_register_import() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner bigint;
    member_count bigint;
    imported_total numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register imports and their evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR NEW.asic_issued_total IS NOT NULL OR NEW.asic_member_count IS NOT NULL
            OR NEW.register_sequence IS NOT NULL OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken t WHERE t.uuid = NEW.token_id
                AND t.company_id = NEW.company_id)
            OR NOT EXISTS (SELECT 1 FROM tokens_shareregister r JOIN tokens_registerentry e ON e.register_id = r.uuid
                WHERE r.token_id = NEW.token_id)
            OR NEW.as_at > current_date
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{{64}}$' OR NEW.asic_fingerprint !~ '^[0-9a-f]{{64}}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-imports/' || NEW.uuid || '/[0-9a-f-]{{36}}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.document_type = 'share_register' AND doc.is_verified
                AND doc.verified_by_id IS NOT NULL AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.asic_document
                AND doc.company_id = NEW.company_id AND doc.document_type = 'asic' AND doc.is_verified
                AND doc.verified_by_id IS NOT NULL AND doc.verified_fingerprint = NEW.asic_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{{64}}$'
            OR jsonb_typeof(NEW.members) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.members) = 0
            OR jsonb_typeof(NEW.former_members) IS DISTINCT FROM 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM {MEMBER_KEYS}
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string' OR item->>'member' !~ '{UUID}'
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '{WHOLE}'
                OR jsonb_typeof(item->'entered_on') IS DISTINCT FROM 'string' OR item->>'entered_on' !~ '{DATE}'
                OR (item->>'entered_on')::date > NEW.as_at
                OR (jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'string'
                    AND jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'null')
                OR (jsonb_typeof(item->'amount_paid') = 'string' AND item->>'amount_paid' !~ '{MONEY}')
                OR NOT EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid::text = item->>'member'
                    AND m.company_id = NEW.company_id))
            OR (SELECT count(DISTINCT item->>'member') FROM jsonb_array_elements(NEW.members) item)
                <> jsonb_array_length(NEW.members)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.former_members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM {FORMER_KEYS}
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '{WHOLE}'
                OR jsonb_typeof(item->'ceased_on') IS DISTINCT FROM 'string' OR item->>'ceased_on' !~ '{DATE}'
                OR (item->>'ceased_on')::date > NEW.as_at
                OR ((item->>'ceased_on')::date < (SELECT e.effective_on FROM tokens_shareregister r
                    JOIN tokens_registerentry e ON e.register_id = r.uuid
                    WHERE r.token_id = NEW.token_id AND e.kind = 'opening')) IS NOT TRUE)
        THEN
            RAISE EXCEPTION 'Register imports require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user = %s OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'asic_issued_total',
            'asic_member_count', 'register_sequence', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'asic_issued_total',
            'asic_member_count', 'register_sequence', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable register import' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        SELECT count(*), sum((item->>'shares')::numeric) INTO member_count, imported_total
            FROM jsonb_array_elements(NEW.members) item;
        IF NEW.rejection_reason <> '' OR NEW.register_sequence IS NULL
            OR NEW.asic_issued_total IS DISTINCT FROM imported_total
            OR NEW.asic_member_count IS DISTINCT FROM member_count
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars p
                    JOIN tokens_registerimport source ON source.uuid = p.source_import_id
                    WHERE p.member_id::text = item->>'member' AND (p.source_import_id = NEW.uuid
                        OR (source.status = 'applied' AND source.as_at > NEW.as_at))))
        THEN
            RAISE EXCEPTION 'Application must match the ASIC figures and record every member''s particulars'
                USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 OR NEW.asic_issued_total IS NOT NULL
        OR NEW.asic_member_count IS NOT NULL OR NEW.register_sequence IS NOT NULL THEN
        RAISE EXCEPTION 'Rejection requires a reason and records no figures' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_import_identity
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerimport
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_import();
""",
            [settings.RLS_ROLES["app"]],
        )
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerimport IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerimport)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain register imports and their evidence; downgrade would discard them.")
        cursor.execute("DROP TRIGGER tokens_register_import_identity ON tokens_registerimport")
        cursor.execute("DROP FUNCTION tokens_guard_register_import()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("tokens", "0071_register_export_audit"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterImport",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("as_at", models.DateField()),
                ("members", models.JSONField()),
                ("former_members", models.JSONField()),
                (
                    "authority",
                    models.CharField(
                        choices=[("director_resolution", "Director resolution"), ("court_order", "Court order")],
                        max_length=24,
                    ),
                ),
                ("approving_director", models.CharField(blank=True, max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField()),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_import.import_evidence_path,
                    ),
                ),
                ("asic_document", models.UUIDField()),
                ("asic_fingerprint", models.CharField(max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("asic_issued_total", models.DecimalField(decimal_places=0, editable=False, max_digits=78, null=True)),
                ("asic_member_count", models.PositiveIntegerField(editable=False, null=True)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False, null=True)),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_imports",
                        to="companies.company",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_imports",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("status", "applied")),
                        fields=("token",),
                        name="one_applied_register_import_per_class",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="RegisterMemberParticulars",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
                (
                    "member",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "source_import",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registerimport",
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="ImportedFormerMember",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
                ("shares_at_cessation", models.DecimalField(decimal_places=0, max_digits=78)),
                ("ceased_on", models.DateField(db_index=True)),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="imported_former_members",
                        to="tokens.sharetoken",
                    ),
                ),
                (
                    "source_import",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="former_members_rows",
                        to="tokens.registerimport",
                    ),
                ),
            ],
            options={
                "ordering": ["-ceased_on", "name"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("shares_at_cessation__gt", 0)),
                        name="imported_former_member_positive_shares",
                    )
                ],
            },
        ),
        migrations.AlterField(
            model_name="formerholder",
            name="identity_source",
            field=models.CharField(
                choices=[
                    ("profile", "Current profile"),
                    ("stamped", "Stamped at the time"),
                    ("recorded", "Name recorded at allotment, identity never resolved"),
                    ("particulars", "Recorded register particulars"),
                    ("treasury_label", "Whitelist entry label, no profile exists"),
                    ("unresolvable", "Not resolvable, two wallets share this address"),
                    ("none", "Not identified"),
                    ("unknown", "Never identified while it held shares"),
                ],
                default="unknown",
                max_length=20,
            ),
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
