import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def restrict_proofs(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON wallets_walletpossessionproof FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON wallets_walletpossessionproof TO {operator_role}")


class Migration(migrations.Migration):

    dependencies = [
        ("wallets", "0023_transaction_market_value_aud"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WalletPossessionProof",
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
                ("wallet_id", models.UUIDField(editable=False)),
                ("account_id", models.UUIDField(editable=False)),
                ("profile_id", models.UUIDField(editable=False)),
                ("address", models.CharField(editable=False, max_length=100)),
                ("chain", models.CharField(editable=False, max_length=20)),
                ("challenge", models.TextField(editable=False)),
                ("challenge_issued_at", models.DateTimeField(editable=False)),
                ("challenge_expires_at", models.DateTimeField(editable=False)),
                ("signature", models.TextField(editable=False)),
                ("completed_at", models.DateTimeField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                (
                    "verified_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["-completed_at", "-uuid"],
                "indexes": [models.Index(fields=["wallet_id", "completed_at"], name="wallets_wal_wallet__0d3dc5_idx")],
                "constraints": [
                    models.UniqueConstraint(fields=("wallet_id", "challenge"), name="one_wallet_proof_per_challenge"),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("completed_at__gte", models.F("challenge_issued_at")),
                            ("completed_at__lt", models.F("challenge_expires_at")),
                        ),
                        name="wallet_proof_challenge_lifetime",
                    ),
                ],
            },
        ),
        migrations.RunPython(restrict_proofs, migrations.RunPython.noop),
    ]
