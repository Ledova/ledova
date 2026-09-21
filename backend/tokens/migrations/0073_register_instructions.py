import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_instruction

GUARDS = """
CREATE FUNCTION tokens_guard_register_instruction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner bigint;
    item_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register instructions and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Register instructions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT count(*) INTO item_count FROM jsonb_array_elements(NEW.items);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR owner IS DISTINCT FROM NEW.submitted_by_id OR NEW.kind <> 'issue'
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken t WHERE t.uuid = NEW.token_id
                AND t.company_id = NEW.company_id)
            OR length(btrim(NEW.approving_director)) = 0
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-instructions/' || NEW.uuid
                || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
            OR item_count = 0
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
                OR (item ? 'request') = (item ? 'subscription')
                OR jsonb_typeof(COALESCE(item->'request', item->'subscription')) IS DISTINCT FROM 'string'
                OR COALESCE(item->>'request', item->>'subscription')
                    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR jsonb_typeof(item->'recipient') IS DISTINCT FROM 'string'
                OR item->>'recipient' !~ '^0x[0-9a-fA-F]{40}$'
                OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
                OR item->>'amount' !~ '^[1-9][0-9]{0,77}$'
                OR (item ? 'request' AND NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                    WHERE r.uuid = (item->>'request')::uuid AND r.token_id = NEW.token_id
                    AND r.company_id = NEW.company_id))
                OR (item ? 'subscription' AND NOT EXISTS (SELECT 1 FROM offerings_subscription s
                    JOIN offerings_offering o ON o.uuid = s.offering_id
                    WHERE s.uuid = (item->>'subscription')::uuid AND o.token_id = NEW.token_id
                    AND s.company_id = NEW.company_id)))
            OR item_count <> (SELECT count(DISTINCT COALESCE(item->>'request', item->>'subscription'))
                FROM jsonb_array_elements(NEW.items) item)
        THEN
            RAISE EXCEPTION 'Register instructions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user = %(app)s OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable register instruction' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
            WHERE item ? 'request' AND NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.uuid = (item->>'request')::uuid AND r.status IN ('approved', 'executing', 'executed', 'failed')))
        THEN
            RAISE EXCEPTION 'Application must approve every listed issuance request' USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_instruction_identity
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerinstruction
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_instruction();

CREATE FUNCTION tokens_guard_issuance_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = %(app)s AND (
        (TG_OP = 'INSERT' AND (NEW.status NOT IN ('draft', 'submitted') OR NEW.reviewed_by_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL OR NEW.review_notes <> '' OR NEW.rejection_reason <> ''))
        OR (TG_OP = 'UPDATE' AND (
            (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('under_review', 'approved', 'rejected'))
            OR ROW(NEW.reviewed_by_id, NEW.reviewed_at, NEW.review_notes, NEW.rejection_reason)
                IS DISTINCT FROM ROW(OLD.reviewed_by_id, OLD.reviewed_at, OLD.review_notes, OLD.rejection_reason)))
    ) THEN
        RAISE EXCEPTION 'Only operator review may decide an issuance request' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'submitted', 'under_review'))
        AND NOT EXISTS (SELECT 1 FROM authentication_customuser
            WHERE id = NEW.reviewed_by_id AND is_active AND is_staff) THEN
        RAISE EXCEPTION 'An issuance approval requires an active staff reviewer' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_issuance_review_decision BEFORE INSERT OR UPDATE ON tokens_shareissuancerequest
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_issuance_review();
"""


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registerinstruction"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(GUARDS, {"app": settings.RLS_ROLES["app"]})
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerinstruction IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerinstruction)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain register instructions and their authority evidence; downgrade would discard it.")
        cursor.execute("DROP TRIGGER tokens_issuance_review_decision ON tokens_shareissuancerequest")
        cursor.execute("DROP FUNCTION tokens_guard_issuance_review()")
        cursor.execute("DROP TRIGGER tokens_register_instruction_identity ON tokens_registerinstruction")
        cursor.execute("DROP FUNCTION tokens_guard_register_instruction()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("tokens", "0072_register_import"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterInstruction",
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
                ("kind", models.CharField(choices=[("issue", "Issue")], max_length=16)),
                ("items", models.JSONField()),
                ("approving_director", models.CharField(max_length=255)),
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
                        upload_to=tokens.models.register_instruction.instruction_evidence_path,
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
                        related_name="register_instructions",
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
                        related_name="register_instructions",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
