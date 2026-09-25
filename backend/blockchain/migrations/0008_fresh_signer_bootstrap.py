import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

TABLE = "blockchain_freshsignerbootstrap"
GUARD = """
CREATE FUNCTION blockchain_guard_fresh_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Fresh signer bootstrap evidence cannot be changed or deleted';
END;
$$
"""


def install_guard(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, (TABLE,))
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(rolname) FROM pg_roles WHERE rolname = ANY(%s)",
            [[settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]],
        )
        for (role,) in cursor.fetchall():
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO {role}")
        cursor.execute(GUARD)
        cursor.execute(
            f"CREATE TRIGGER {TABLE}_immutable BEFORE UPDATE OR DELETE ON {TABLE} "
            "FOR EACH ROW EXECUTE FUNCTION blockchain_guard_fresh_bootstrap()"
        )


def remove_guard(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f"DROP TRIGGER {TABLE}_immutable ON {TABLE}")
        cursor.execute("DROP FUNCTION blockchain_guard_fresh_bootstrap()")


class Migration(migrations.Migration):
    dependencies = [("blockchain", "0007_transaction_outgoing_operation")]

    operations = [
        migrations.CreateModel(
            name="FreshSignerBootstrap",
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
                ("manifest_digest", models.CharField(editable=False, max_length=64, unique=True)),
                ("validator_version", models.CharField(editable=False, max_length=32)),
                ("manifest", models.JSONField(editable=False)),
                ("artifact_identities", models.JSONField(editable=False)),
                ("chain_evidence", models.JSONField(editable=False)),
                (
                    "signer",
                    models.OneToOneField(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bootstrap",
                        to="blockchain.signingaccount",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(manifest_digest__regex=r"^[0-9a-f]{64}$"),
                        name="fresh_signer_manifest_digest",
                    )
                ]
            },
        ),
        migrations.RunPython(install_guard, remove_guard),
    ]
