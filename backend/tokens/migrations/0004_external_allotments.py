import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_allotment


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0002_initial"),
        ("tokens", "0003_employee_awards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterAgreement",
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
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_allotment.allotment_evidence_path,
                    ),
                ),
                ("reference", models.CharField(max_length=255)),
                ("agreed_on", models.DateField()),
                ("terms", models.CharField(max_length=1000)),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterAllotment",
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
                ("consideration", models.DecimalField(decimal_places=2, max_digits=20)),
                ("currency", models.CharField(default="AUD", max_length=3)),
                ("approving_director", models.CharField(max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_allotment.allotment_evidence_path,
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
            name="RegisterAllotmentDecision",
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
        migrations.CreateModel(
            name="RegisterContribution",
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
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_allotment.allotment_evidence_path,
                    ),
                ),
                ("amount", models.DecimalField(decimal_places=2, max_digits=20)),
                ("currency", models.CharField(default="AUD", max_length=3)),
                ("received_on", models.DateField()),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.RemoveConstraint(
            model_name="registermemberparticulars",
            name="register_member_particulars_one_source",
        ),
        migrations.AddField(
            model_name="registeragreement",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registeragreement",
            name="evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registeragreement",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registeragreement",
            name="recorded_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="agreement",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="allotment", to="tokens.registeragreement"
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_allotments", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="register_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="allotment",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
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
            model_name="registerallotment",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_allotments", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_allotment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registerallotment",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    models.Q(
                        ("source_allotment__isnull", False),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
        migrations.AddField(
            model_name="registerallotmentdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerallotmentdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerallotmentdecision",
            name="register_allotment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerallotment"
            ),
        ),
        migrations.AddField(
            model_name="registercontribution",
            name="agreement",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="contribution", to="tokens.registeragreement"
            ),
        ),
        migrations.AddField(
            model_name="registercontribution",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registercontribution",
            name="evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registercontribution",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registercontribution",
            name="recorded_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="contribution",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="allotment", to="tokens.registercontribution"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerallotmentdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_allotment_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerallotmentdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_allotment",),
                name="one_register_allotment_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerallotment",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_allotment_positive_shares"
            ),
        ),
        migrations.RunSQL(
            "ALTER TABLE tokens_registerallotment ALTER COLUMN shares TYPE numeric; "
            "ALTER TABLE tokens_registerallotment ALTER COLUMN consideration TYPE numeric; "
            "ALTER TABLE tokens_registercontribution ALTER COLUMN amount TYPE numeric",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
