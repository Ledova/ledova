import uuid

import django.db.models.deletion
from django.db import migrations, models


def install_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""
CREATE FUNCTION tokens_guard_register_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Register export records are retained as written' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER tokens_register_export_record
    BEFORE UPDATE ON tokens_registerexport
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_export();
""")


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerexport IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerexport)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain register export records; downgrade would discard them.")
        cursor.execute("DROP TRIGGER tokens_register_export_record ON tokens_registerexport")
        cursor.execute("DROP FUNCTION tokens_guard_register_export()")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0070_register_reconciliation"),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterExport",
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
                ("requested_by_id", models.PositiveBigIntegerField(editable=False)),
                ("kind", models.CharField(choices=[("register_csv", "Register CSV")], editable=False, max_length=24)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False)),
                ("member_rows", models.PositiveIntegerField(editable=False)),
                ("former_rows", models.PositiveIntegerField(editable=False)),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.DO_NOTHING,
                        related_name="register_exports",
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
