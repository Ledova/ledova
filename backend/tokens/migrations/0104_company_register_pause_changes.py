import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_pause_change


def restrict_pause_sources(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        for table in ("tokens_registerpausechange", "tokens_registerpausechangedecision"):
            cursor.execute(f"REVOKE ALL ON {table} FROM {app_role}")
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {operator_role}")


def retain_pause_sources(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registerpausechange, tokens_registerpausechangedecision, tokens_pausechange IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_registerpausechange) OR EXISTS (SELECT 1 FROM tokens_registerpausechangedecision) OR EXISTS (SELECT 1 FROM tokens_pausechange WHERE source_pause_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company pause sources, decisions and original journal history.")


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0008_fresh_signer_bootstrap"),
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0103_company_register_capital_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterPauseChange",
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
                ("paused", models.BooleanField(editable=False)),
                ("reason", models.CharField(editable=False, max_length=1000)),
                ("authority_reference", models.CharField(editable=False, max_length=255)),
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
                        upload_to=tokens.models.register_pause_change.pause_evidence_path,
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterPauseChangeDecision",
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
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.RemoveConstraint(
            model_name="pausechange",
            name="pause_change_authority",
        ),
        migrations.AlterField(
            model_name="pausechange",
            name="authority",
            field=models.CharField(
                choices=[("issuer", "Issuer"), ("staff", "Token administration"), ("company", "Company")],
                editable=False,
                max_length=7,
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_pause_changes",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_pause_changes",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="pausechange",
            name="source_pause",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="execution",
                to="tokens.registerpausechange",
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("authority__in", ["issuer", "staff", "company"])), name="pause_change_authority"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechangedecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechangedecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerpausechangedecision",
            name="pause_change",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerpausechange"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerpausechangedecision",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerpausechangedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_pause_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerpausechangedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("pause_change",),
                name="one_register_pause_outcome",
            ),
        ),
        migrations.RunPython(restrict_pause_sources, retain_pause_sources),
    ]
