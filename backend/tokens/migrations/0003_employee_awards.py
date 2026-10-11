import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_award


class Migration(migrations.Migration):

    dependencies = [("tokens", "0002_initial")]

    operations = [
        migrations.CreateModel(
            name="RegisterAward",
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
                ("terms", models.CharField(max_length=1000)),
                ("schedule", models.CharField(max_length=1000)),
                ("agreement_fingerprint", models.CharField(max_length=64)),
                ("agreement_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_award.award_evidence_path,
                    ),
                ),
                (
                    "agreement_evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_awards",
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
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_awards",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="registergrant",
            name="award",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="grants", to="tokens.registeraward"
            ),
        ),
        migrations.CreateModel(
            name="RegisterAwardVesting",
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
                ("shares", models.DecimalField(decimal_places=0, max_digits=78)),
                ("vested_on", models.DateField()),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_award.award_vesting_evidence_path,
                    ),
                ),
                (
                    "award",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="vestings", to="tokens.registeraward"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_award_vestings",
                        to="companies.company",
                    ),
                ),
                (
                    "evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["-vested_on", "-created_at", "-uuid"],
            },
        ),
        migrations.AddConstraint(
            model_name="registeraward",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_award_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerawardvesting",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_award_vesting_positive_shares"
            ),
        ),
        migrations.RunSQL(
            "ALTER TABLE tokens_registeraward ALTER COLUMN shares TYPE numeric; "
            "ALTER TABLE tokens_registerawardvesting ALTER COLUMN shares TYPE numeric",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
