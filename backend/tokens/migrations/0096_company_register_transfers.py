import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_transfer


def install_transfer_policies(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registertransfer", "tokens_registermembercessation"])
    grant_reachable_tables(schema_editor)


def remove_transfer_policies(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for table in ("tokens_registertransfer", "tokens_registermembercessation"):
            for suffix in ("read", "insert", "update", "delete"):
                cursor.execute(f"DROP POLICY IF EXISTS {table}_{suffix} ON {table}")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0095_company_register_grant_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterMemberCessation",
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
                ("ceased_on", models.DateField(db_index=True)),
                ("shares_at_cessation", models.DecimalField(decimal_places=0, max_digits=78)),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
                ("identity_source", models.CharField(default="particulars", max_length=20)),
                ("particulars_snapshot", models.JSONField()),
            ],
            options={
                "ordering": ["-ceased_on", "-entry__sequence", "member_id"],
            },
        ),
        migrations.CreateModel(
            name="RegisterTransfer",
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
                ("from_member", models.UUIDField()),
                ("to_member", models.UUIDField()),
                ("new_member", models.BooleanField()),
                ("new_particulars", models.BooleanField()),
                ("from_name", models.CharField(max_length=255)),
                ("from_residential_address", models.TextField()),
                ("from_particulars", models.JSONField()),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
                ("to_particulars", models.JSONField(null=True)),
                ("shares", models.DecimalField(decimal_places=0, max_digits=78)),
                ("signed_on", models.DateField()),
                ("lodged_on", models.DateField()),
                ("terms", models.CharField(max_length=1000)),
                ("authority", models.CharField(default="director_resolution", max_length=24)),
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
                        upload_to=tokens.models.register_transfer.transfer_evidence_path,
                    ),
                ),
                ("instrument_fingerprint", models.CharField(max_length=64)),
                ("instrument_snapshot", models.JSONField()),
                (
                    "instrument_file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_transfer.transfer_evidence_path,
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
            name="RegisterTransferDecision",
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
            model_name="registermembercessation",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="member_cessations", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="entry",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="member_cessations", to="tokens.registerentry"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="member",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="cessations", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="member_cessations", to="tokens.shareregister"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="returned_entry",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="member_returns",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation", name="returned_on", field=models.DateField(null=True)
        ),
        migrations.AddField(
            model_name="registermembercessation", name="returned_at", field=models.DateTimeField(null=True)
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_transfers", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="instrument_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="register_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="direct_transfer",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
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
            model_name="registertransfer",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_transfers", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_transfer",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registertransfer",
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
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
        migrations.AddField(
            model_name="registertransferdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registertransferdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registertransferdecision",
            name="register_transfer",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registertransfer"
            ),
        ),
        migrations.AddConstraint(
            model_name="registermembercessation",
            constraint=models.UniqueConstraint(fields=("member", "entry"), name="one_member_cessation_per_entry"),
        ),
        migrations.AddConstraint(
            model_name="registermembercessation",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares_at_cessation__gt", 0)), name="register_cessation_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransfer",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_transfer_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransfer",
            constraint=models.CheckConstraint(
                condition=models.Q(("from_member", models.F("to_member")), _negated=True),
                name="register_transfer_distinct_members",
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransferdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_transfer_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransferdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_transfer",),
                name="one_register_transfer_outcome",
            ),
        ),
        migrations.RunPython(install_transfer_policies, remove_transfer_policies),
    ]
