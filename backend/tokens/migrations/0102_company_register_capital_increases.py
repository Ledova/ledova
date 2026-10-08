import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_capital_increase


def restrict_capital_sources(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["tokens_capitalincreaserequest"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        for table in ("tokens_registercapitalincrease", "tokens_registercapitalincreasedecision"):
            cursor.execute(f"REVOKE ALL ON {table} FROM {app_role}")
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {operator_role}")


def retain_capital_sources(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registercapitalincrease, tokens_registercapitalincreasedecision, tokens_capitalincreaseexecution IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_registercapitalincrease) OR EXISTS (SELECT 1 FROM tokens_registercapitalincreasedecision) OR EXISTS (SELECT 1 FROM tokens_capitalincreaseexecution WHERE source_increase_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company capital sources, decisions and original execution history.")
        from shared.db.policies import ADMITTED, MANAGEABLE_COMPANIES, VISIBLE_COMPANIES

        readable = f"company_id IN (SELECT {VISIBLE_COMPANIES}())"
        writable = f"company_id IN (SELECT {MANAGEABLE_COMPANIES}())"
        for suffix in ("read", "insert", "update", "delete"):
            cursor.execute(
                f"DROP POLICY IF EXISTS tokens_capitalincreaserequest_{suffix} ON tokens_capitalincreaserequest"
            )
        cursor.execute(
            f"CREATE POLICY tokens_capitalincreaserequest_read ON tokens_capitalincreaserequest FOR SELECT USING ({ADMITTED} AND ({readable}))"
        )
        cursor.execute(
            f"CREATE POLICY tokens_capitalincreaserequest_insert ON tokens_capitalincreaserequest FOR INSERT WITH CHECK ({ADMITTED} AND ({writable}))"
        )
        cursor.execute(
            f"CREATE POLICY tokens_capitalincreaserequest_update ON tokens_capitalincreaserequest FOR UPDATE USING ({ADMITTED} AND ({readable})) WITH CHECK ({ADMITTED} AND ({writable}))"
        )
        cursor.execute(
            f"CREATE POLICY tokens_capitalincreaserequest_delete ON tokens_capitalincreaserequest FOR DELETE USING ({ADMITTED} AND ({writable}))"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0101_company_register_issue_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterCapitalIncrease",
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
                ("snapshot", models.JSONField(editable=False)),
                ("intent", models.JSONField(editable=False)),
                ("intent_digest", models.CharField(editable=False, max_length=64)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_capital_increase.capital_evidence_path,
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
                    "authority_evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_capital_increases",
                        to="companies.company",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="company_instruction",
                        to="tokens.capitalincreaserequest",
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
                        related_name="register_capital_increases",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="capitalincreaseexecution",
            name="source_increase",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="executions",
                to="tokens.registercapitalincrease",
            ),
        ),
        migrations.CreateModel(
            name="RegisterCapitalIncreaseDecision",
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
                    "kind",
                    models.CharField(
                        choices=[("approve", "Approve"), ("apply", "Apply"), ("reject", "Reject")], max_length=8
                    ),
                ),
                ("idempotency_key", models.UUIDField()),
                ("digest", models.CharField(max_length=64)),
                ("reason", models.CharField(blank=True, max_length=1000)),
                ("decided_at", models.DateTimeField()),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "capital_increase",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registercapitalincrease",
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registercapitalincreasedecision",
            ),
        ),
        migrations.AddConstraint(
            model_name="registercapitalincreasedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_capital_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registercapitalincreasedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("capital_increase",),
                name="one_register_capital_outcome",
            ),
        ),
        migrations.RunPython(restrict_capital_sources, retain_capital_sources),
    ]
