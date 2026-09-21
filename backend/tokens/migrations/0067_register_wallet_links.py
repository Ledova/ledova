import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_opening


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registerwalletlink"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION tokens_guard_register_wallet_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner bigint;
    mapping_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain wallet link requests and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.mapping) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Wallet link requests require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-links/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
            OR mapping_count = 0
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'member')
                OR jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string'
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR mapping_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.mapping) item)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermember m ON m.uuid::text = item->>'member'
                WHERE m.company_id IS DISTINCT FROM NEW.company_id)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermemberwallet w ON w.company_id = NEW.company_id
                    AND lower(w.address) = lower(item->>'address'))
        THEN
            RAISE EXCEPTION 'Wallet link requests require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user = %s OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable wallet link request' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
            WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet w
                WHERE w.company_id = NEW.company_id AND lower(w.address) = lower(item->>'address')
                AND w.member_id::text = item->>'member')
            OR NOT EXISTS (SELECT 1 FROM tokens_registermember m
                WHERE m.uuid::text = item->>'member' AND m.company_id = NEW.company_id))
        THEN
            RAISE EXCEPTION 'Approval must link every mapped wallet to its member' USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_wallet_link_identity
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerwalletlink
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_wallet_link();
""",
            [settings.RLS_ROLES["app"]],
        )
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerwalletlink IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerwalletlink)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain wallet link requests and their authority evidence; downgrade would discard it.")
        cursor.execute("DROP TRIGGER tokens_register_wallet_link_identity ON tokens_registerwalletlink")
        cursor.execute("DROP FUNCTION tokens_guard_register_wallet_link()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("tokens", "0066_issuance_finality_and_boundary_history"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterWalletLink",
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
                ("mapping", models.JSONField()),
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
                        upload_to=tokens.models.register_opening.link_evidence_path,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_wallet_links",
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
