import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_correction


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registercorrection"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION tokens_guard_register_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    original tokens_registerentry;
    applied tokens_registerentry;
    head tokens_shareregister;
    owner bigint;
    inverse jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain correction proposals and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT * INTO head FROM tokens_shareregister WHERE uuid = NEW.register_id FOR UPDATE;
        SELECT * INTO original FROM tokens_registerentry WHERE uuid = NEW.corrects_id;
        SELECT jsonb_agg(jsonb_build_object('member', value->>'member',
            'shares', (-(value->>'shares')::numeric)::text) ORDER BY value->>'member')
            INTO inverse FROM jsonb_array_elements(original.changes);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR head.company_id IS DISTINCT FROM NEW.company_id
            OR original.register_id IS DISTINCT FROM NEW.register_id
            OR NEW.base_sequence IS DISTINCT FROM head.sequence OR NEW.base_hash IS DISTINCT FROM head.head_hash
            OR inverse IS NULL OR NEW.changes IS DISTINCT FROM inverse
            OR EXISTS (SELECT 1 FROM tokens_registerentry WHERE corrects_id = NEW.corrects_id)
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-corrections/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
        THEN
            RAISE EXCEPTION 'Correction submissions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user = %s OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
            OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'applied_entry_id', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'applied_entry_id', 'updated_at'])
            OR NEW.reviewed_at IS NULL OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
            ) THEN
            RAISE EXCEPTION 'Only operator review may decide an immutable correction submission' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            SELECT * INTO applied FROM tokens_registerentry WHERE uuid = NEW.applied_entry_id;
            IF applied.uuid IS NULL OR applied.register_id <> NEW.register_id OR applied.kind <> 'correction'
                OR applied.operation_id <> NEW.uuid OR applied.corrects_id IS DISTINCT FROM NEW.corrects_id
                OR applied.changes IS DISTINCT FROM NEW.changes OR applied.effective_on <> NEW.effective_on
                OR applied.recorded_by_id <> NEW.reviewed_by_id
                OR applied.previous_hash <> NEW.base_hash OR applied.sequence <> NEW.base_sequence + 1
                OR NEW.rejection_reason <> '' THEN
                RAISE EXCEPTION 'Approval must record the matching compensating entry' USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.applied_entry_id IS NOT NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
            RAISE EXCEPTION 'Rejection requires a reason and no applied entry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_correction_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registercorrection
FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_correction();
""",
            [settings.RLS_ROLES["app"]],
        )
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registercorrection IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registercorrection)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain correction authority evidence; downgrade would discard it.")
        cursor.execute("DROP TRIGGER tokens_register_correction_identity ON tokens_registercorrection")
        cursor.execute("DROP FUNCTION tokens_guard_register_correction()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("tokens", "0063_swap_finalized_receipt"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterCorrection",
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
                ("base_sequence", models.PositiveBigIntegerField()),
                ("base_hash", models.CharField(max_length=64)),
                ("effective_on", models.DateField()),
                ("changes", models.JSONField()),
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
                        upload_to=tokens.models.register_correction.correction_evidence_path,
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
                    "applied_entry",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="approved_correction",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_corrections",
                        to="companies.company",
                    ),
                ),
                (
                    "corrects",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="proposals", to="tokens.registerentry"
                    ),
                ),
                (
                    "register",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="corrections",
                        to="tokens.shareregister",
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
