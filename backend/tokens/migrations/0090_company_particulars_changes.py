import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_particulars

AS_AT_OF_EACH_IMPORT = """
UPDATE tokens_registermemberparticulars particulars SET as_at = source.as_at
    FROM tokens_registerimport source WHERE source.uuid = particulars.source_import_id
"""


def install_change_policies(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registerparticularschange"])
    grant_reachable_tables(schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0087_company_discrepancy_acknowledgements"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="registerevidence",
            name="kind",
            field=models.CharField(
                choices=[
                    ("share_register", "Share register"),
                    ("asic_extract", "ASIC extract"),
                    ("authority", "Authority document"),
                    ("supporting", "Supporting document"),
                ],
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="RegisterParticularsChange",
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
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
                ("as_at", models.DateField()),
                ("reason", models.CharField(max_length=1000)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_particulars.particulars_evidence_path,
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
                        related_name="register_particulars_changes",
                        to="companies.company",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars_changes",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyappointment",
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
                    "supporting_evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterParticularsChangeDecision",
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
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyappointment",
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_particulars_change",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerparticularschange",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
                "constraints": [
                    models.UniqueConstraint(
                        fields=("decided_by", "idempotency_key"), name="one_register_particulars_decision_per_key"
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(("kind__in", ["apply", "reject"])),
                        fields=("register_particulars_change",),
                        name="one_register_particulars_outcome",
                    ),
                ],
            },
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="as_at",
            field=models.DateField(null=True),
        ),
        migrations.RunSQL(AS_AT_OF_EACH_IMPORT, migrations.RunSQL.noop),
        migrations.AlterField(
            model_name="registermemberparticulars",
            name="as_at",
            field=models.DateField(),
        ),
        migrations.AlterField(
            model_name="registermemberparticulars",
            name="source_import",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registerimport",
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_change",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registerparticularschange",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("source_change__isnull", True), ("source_import__isnull", False)),
                    models.Q(("source_change__isnull", False), ("source_import__isnull", True)),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
        migrations.RunPython(install_change_policies, migrations.RunPython.noop),
    ]
