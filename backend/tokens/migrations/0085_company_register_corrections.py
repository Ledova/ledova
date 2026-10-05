import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def restore_owner_submissions(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["tokens_registercorrection"])


def close_owner_submissions(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registercorrection"])
    grant_reachable_tables(schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0084_company_register_import_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(migrations.RunPython.noop, restore_owner_submissions),
        migrations.CreateModel(
            name="RegisterCorrectionDecision",
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
        migrations.AddField(
            model_name="registercorrection",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AlterField(
            model_name="registercorrection",
            name="source_document",
            field=models.UUIDField(null=True),
        ),
        migrations.AlterField(
            model_name="registerevidence",
            name="kind",
            field=models.CharField(
                choices=[
                    ("share_register", "Share register"),
                    ("asic_extract", "ASIC extract"),
                    ("authority", "Authority document"),
                ],
                max_length=16,
            ),
        ),
        migrations.AddConstraint(
            model_name="registercorrection",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("authority_evidence__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("authority_evidence__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("source_document__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_correction_exact_provenance",
            ),
        ),
        migrations.AddField(
            model_name="registercorrectiondecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registercorrectiondecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registercorrectiondecision",
            name="register_correction",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registercorrection"
            ),
        ),
        migrations.AddConstraint(
            model_name="registercorrectiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_correction_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registercorrectiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_correction",),
                name="one_register_correction_outcome",
            ),
        ),
        migrations.RunPython(close_owner_submissions, migrations.RunPython.noop),
    ]
