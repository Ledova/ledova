import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_grant


def install_grant_policies(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registergrant"])
    grant_reachable_tables(schema_editor)


def remove_grant_policies(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for suffix in ("read", "insert", "update", "delete"):
            cursor.execute(f"DROP POLICY IF EXISTS tokens_registergrant_{suffix} ON tokens_registergrant")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0093_company_register_wallet_link_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterGrant",
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
                ("member", models.UUIDField()),
                ("new_member", models.BooleanField()),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
                ("shares", models.DecimalField(decimal_places=0, max_digits=78)),
                ("terms_on", models.DateField()),
                ("approving_director", models.CharField(max_length=255)),
                ("terms", models.CharField(max_length=1000)),
                ("acceptance_required", models.BooleanField()),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_grant.grant_evidence_path,
                    ),
                ),
                ("terms_fingerprint", models.CharField(max_length=64)),
                ("terms_snapshot", models.JSONField()),
                (
                    "terms_file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_grant.grant_evidence_path,
                    ),
                ),
                ("acceptance_fingerprint", models.CharField(blank=True, max_length=64)),
                ("acceptance_snapshot", models.JSONField(null=True)),
                (
                    "acceptance_file",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_grant.grant_evidence_path,
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
            name="RegisterGrantDecision",
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
            model_name="registermemberparticulars",
            name="register_member_particulars_one_source",
        ),
        migrations.AddField(
            model_name="registergrant",
            name="acceptance_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_grants", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="register_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="grant",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
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
            model_name="registergrant",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="terms_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_grants", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_grant",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registergrant",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                    ),
                    models.Q(
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
        migrations.AddField(
            model_name="registergrantdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registergrantdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registergrantdecision",
            name="register_grant",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registergrant"
            ),
        ),
        migrations.AddConstraint(
            model_name="registergrant",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_grant_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registergrantdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_grant_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registergrantdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_grant",),
                name="one_register_grant_outcome",
            ),
        ),
        migrations.RunPython(install_grant_policies, remove_grant_policies),
    ]
