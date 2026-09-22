import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registerreconciliation"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""
CREATE FUNCTION tokens_guard_register_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain register reconciliations as recorded' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.discrepancies) IS DISTINCT FROM 'array'
        OR NEW.status NOT IN ('matched', 'discrepant', 'failed')
        OR (NEW.status IN ('matched', 'discrepant') AND (
            NEW.block_number IS NULL OR NEW.block_hash !~ '^0x[0-9a-f]{64}$' OR NEW.register_sequence IS NULL
            OR NEW.failure <> '' OR (jsonb_array_length(NEW.discrepancies) = 0) <> (NEW.status = 'matched')))
        OR (NEW.status = 'failed' AND (
            NEW.block_number IS NOT NULL OR NEW.block_hash <> '' OR jsonb_array_length(NEW.discrepancies) <> 0
            OR length(btrim(NEW.failure)) = 0))
    THEN
        RAISE EXCEPTION 'A register reconciliation records a result consistent with its status'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_reconciliation_record
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerreconciliation
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_reconciliation();
""")
        cursor.execute(
            """
CREATE FUNCTION tokens_guard_register_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    acknowledged tokens_registerreconciliation;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain register acknowledgements as recorded' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO acknowledged FROM tokens_registerreconciliation WHERE uuid = NEW.reconciliation_id;
    IF current_user = %s
        OR acknowledged.token_id IS DISTINCT FROM NEW.token_id
        OR COALESCE(NEW.discrepancy->>'kind', '') NOT IN ('unrecognised_transfer', 'member', 'unlinked', 'supply')
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(acknowledged.discrepancies) item
            WHERE item = NEW.discrepancy)
        OR length(btrim(NEW.reason)) = 0
        OR NOT EXISTS (SELECT 1 FROM authentication_customuser
            WHERE id = NEW.acknowledged_by_id AND is_active AND is_staff)
    THEN
        RAISE EXCEPTION 'Active staff acknowledge one exact discrepancy of a reconciliation, with a reason'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_acknowledgement_record
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registeracknowledgement
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_acknowledgement();
""",
            [settings.RLS_ROLES["app"]],
        )
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registerreconciliation, tokens_registeracknowledgement IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerreconciliation)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain register reconciliations; downgrade would discard them.")
        cursor.execute("DROP TRIGGER tokens_register_acknowledgement_record ON tokens_registeracknowledgement")
        cursor.execute("DROP FUNCTION tokens_guard_register_acknowledgement()")
        cursor.execute("DROP TRIGGER tokens_register_reconciliation_record ON tokens_registerreconciliation")
        cursor.execute("DROP FUNCTION tokens_guard_register_reconciliation()")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0069_opening_mapping_values"),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterReconciliation",
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
                (
                    "status",
                    models.CharField(
                        choices=[("matched", "Matched"), ("discrepant", "Discrepant"), ("failed", "Failed")],
                        editable=False,
                        max_length=12,
                    ),
                ),
                ("block_number", models.PositiveBigIntegerField(editable=False, null=True)),
                ("block_hash", models.CharField(blank=True, editable=False, max_length=66)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False, null=True)),
                ("discrepancies", models.JSONField(default=list, editable=False)),
                ("failure", models.CharField(blank=True, editable=False, max_length=500)),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_reconciliations",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterAcknowledgement",
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
                ("token_id", models.UUIDField(editable=False)),
                ("discrepancy", models.JSONField(editable=False)),
                ("reason", models.CharField(editable=False, max_length=1000)),
                ("acknowledged_by_id", models.PositiveBigIntegerField(editable=False)),
                (
                    "reconciliation",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="acknowledgements",
                        to="tokens.registerreconciliation",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at", "uuid"],
                "constraints": [
                    models.UniqueConstraint(fields=("reconciliation", "discrepancy"), name="register_acknowledged_once")
                ],
            },
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
