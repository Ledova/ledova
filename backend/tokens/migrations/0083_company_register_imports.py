import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_evidence
import tokens.models.register_import


def restore_owner_submissions(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["tokens_registerimport"])


def close_owner_submissions(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registerimport"])
    grant_reachable_tables(schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0081_held_orders_and_retired_statuses"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(migrations.RunPython.noop, restore_owner_submissions),
        migrations.CreateModel(
            name="RegisterImportDecision",
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
            },
        ),
        migrations.AddField(
            model_name="registerimport",
            name="asic_file",
            field=models.FileField(
                blank=True,
                max_length=255,
                storage=shared.storage.private_storage,
                upload_to=tokens.models.register_import.import_evidence_path,
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="asic_snapshot",
            field=models.JSONField(null=True),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AlterField(
            model_name="registerimport",
            name="asic_document",
            field=models.UUIDField(null=True),
        ),
        migrations.AlterField(
            model_name="registerimport",
            name="source_document",
            field=models.UUIDField(null=True),
        ),
        migrations.CreateModel(
            name="RegisterEvidence",
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
                        choices=[("share_register", "Share register"), ("asic_extract", "ASIC extract")], max_length=16
                    ),
                ),
                ("idempotency_key", models.UUIDField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_evidence.register_evidence_path,
                    ),
                ),
                ("original_filename", models.CharField(max_length=255)),
                ("file_size", models.PositiveIntegerField()),
                ("mime_type", models.CharField(max_length=64)),
                ("sha256", models.CharField(max_length=64)),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_evidence",
                        to="companies.company",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="registerimport",
            name="asic_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="register_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("asic_document__isnull", False),
                        ("asic_evidence__isnull", True),
                        ("asic_file", ""),
                        ("asic_snapshot__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("register_evidence__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("asic_document__isnull", True),
                        ("asic_evidence__isnull", False),
                        ("asic_issued_total__isnull", False),
                        ("asic_member_count__isnull", False),
                        ("asic_snapshot__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("register_evidence__isnull", False),
                        ("source_document__isnull", True),
                        models.Q(("asic_file", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_import_exact_provenance",
            ),
        ),
        migrations.AddField(
            model_name="registerimportdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerimportdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerimportdecision",
            name="register_import",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerimport"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerevidence",
            constraint=models.UniqueConstraint(
                fields=("uploaded_by", "idempotency_key"), name="one_register_evidence_per_upload_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerevidence",
            constraint=models.CheckConstraint(
                condition=models.Q(("file_size__gt", 0)), name="register_evidence_has_content"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimportdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_import_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimportdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_import",),
                name="one_register_import_outcome",
            ),
        ),
        migrations.RunPython(close_owner_submissions, migrations.RunPython.noop),
    ]
