import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_award


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0004_signup_terms_acceptance"),
        ("tokens", "0008_company_event_dates"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterAwardEnd",
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
                ("unvested_shares", models.DecimalField(decimal_places=0, max_digits=78)),
                ("vested_shares", models.DecimalField(decimal_places=0, max_digits=78)),
                ("company_event_on", models.DateField()),
                ("reason", models.CharField(max_length=1000)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_award.award_end_evidence_path,
                    ),
                ),
                (
                    "award",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="ends", to="tokens.registeraward"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_award_ends",
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
                "ordering": ["-company_event_on", "-created_at", "-uuid"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("unvested_shares__gte", 0),
                            ("vested_shares__gte", 0),
                            models.Q(("unvested_shares__gt", 0), ("vested_shares__gt", 0), _connector="OR"),
                        ),
                        name="register_award_end_positive_quantity",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="RegisterAwardVestingReversal",
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
                ("reversed_shares", models.DecimalField(decimal_places=0, max_digits=78)),
                ("company_event_on", models.DateField()),
                ("reason", models.CharField(max_length=1000)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_award.award_vesting_reversal_evidence_path,
                    ),
                ),
                (
                    "award",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="vesting_reversals",
                        to="tokens.registeraward",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_award_vesting_reversals",
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
                (
                    "vesting",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="reversals",
                        to="tokens.registerawardvesting",
                    ),
                ),
            ],
            options={
                "ordering": ["-company_event_on", "-created_at", "-uuid"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("reversed_shares__gt", 0)), name="register_award_reversal_positive_quantity"
                    )
                ],
            },
        ),
        migrations.RunSQL(
            "ALTER TABLE tokens_registerawardend ALTER COLUMN unvested_shares TYPE numeric; "
            "ALTER TABLE tokens_registerawardend ALTER COLUMN vested_shares TYPE numeric; "
            "ALTER TABLE tokens_registerawardvestingreversal ALTER COLUMN reversed_shares TYPE numeric",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
