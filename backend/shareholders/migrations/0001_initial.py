import uuid

import django.db.models.deletion
from django.db import migrations, models

import shared.storage
import shareholders.models.event
import shareholders.models.publication


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("companies", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PublicationEvent",
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
                ("sequence", models.PositiveBigIntegerField(default=0, editable=False)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("ballot", "Ballot"),
                            ("close", "Close"),
                            ("payment", "Payment recorded"),
                            ("payment_void", "Payment record withdrawn"),
                        ],
                        max_length=16,
                    ),
                ),
                (
                    "choice",
                    models.CharField(
                        blank=True,
                        choices=[("for", "For"), ("against", "Against"), ("abstain", "Abstain")],
                        max_length=8,
                    ),
                ),
                ("shares", models.DecimalField(decimal_places=0, editable=False, max_digits=78, null=True)),
                ("actor_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("staff_entered", models.BooleanField(default=False)),
                ("authority", models.CharField(blank=True, max_length=255)),
                ("payload", models.JSONField(editable=False, null=True)),
                ("paid_on", models.DateField(blank=True, null=True, verbose_name="recorded as paid on")),
                (
                    "reference",
                    models.CharField(blank=True, max_length=64, verbose_name="the company's payment reference"),
                ),
                (
                    "evidence",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=shareholders.models.event.payment_evidence_path,
                    ),
                ),
                ("evidence_digest", models.CharField(blank=True, max_length=64)),
                ("evidence_mime_type", models.CharField(blank=True, max_length=100)),
                ("previous_hash", models.CharField(blank=True, editable=False, max_length=64)),
                ("entry_hash", models.CharField(blank=True, editable=False, max_length=64)),
            ],
            options={
                "ordering": ["sequence"],
            },
        ),
        migrations.CreateModel(
            name="PublicationRead",
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
                ("actor_id", models.PositiveBigIntegerField()),
                ("publication_uuid", models.UUIDField(db_index=True)),
                ("recipient_uuid", models.UUIDField(blank=True, null=True)),
                ("event_uuid", models.UUIDField(blank=True, null=True)),
                (
                    "kind",
                    models.CharField(
                        choices=[("member", "Member"), ("company", "Company"), ("staff", "Staff")], max_length=16
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="PublicationRecipient",
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
                ("member_id", models.UUIDField(editable=False)),
                ("user_id", models.PositiveBigIntegerField(editable=False, null=True)),
                ("name", models.CharField(blank=True, editable=False, max_length=255)),
                (
                    "holder_type",
                    models.CharField(
                        choices=[
                            ("member", "Member"),
                            ("treasury", "Treasury"),
                            ("ambiguous", "Ambiguous"),
                            ("unidentified", "Unidentified"),
                        ],
                        editable=False,
                        max_length=16,
                    ),
                ),
                (
                    "identity_source",
                    models.CharField(
                        choices=[
                            ("profile", "Current profile"),
                            ("stamped", "Stamped at the time"),
                            ("recorded", "Name recorded at allotment, identity never resolved"),
                            ("particulars", "Recorded register particulars"),
                            ("treasury_label", "Whitelist entry label, no profile exists"),
                            ("unresolvable", "Not resolvable, two wallets share this address"),
                            ("none", "Not identified"),
                            ("unknown", "Never identified while it held shares"),
                        ],
                        editable=False,
                        max_length=24,
                    ),
                ),
                ("shares", models.DecimalField(decimal_places=0, editable=False, max_digits=78)),
                ("entitlement", models.DecimalField(decimal_places=2, editable=False, max_digits=18, null=True)),
            ],
            options={
                "ordering": ["-shares", "member_id"],
            },
        ),
        migrations.CreateModel(
            name="Publication",
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
                ("company_name", models.CharField(editable=False, max_length=255)),
                ("token_name", models.CharField(editable=False, max_length=100)),
                ("token_symbol", models.CharField(editable=False, max_length=10)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("holding_statement", "Annual holding statement"),
                            ("meeting_notice", "Meeting notice"),
                            ("resolution", "Resolution"),
                            ("distribution", "Dividend"),
                        ],
                        editable=False,
                        max_length=32,
                    ),
                ),
                ("title", models.CharField(editable=False, max_length=255)),
                ("record_date", models.DateField(editable=False)),
                ("instruction", models.CharField(editable=False, max_length=255)),
                ("authority_document", models.UUIDField(editable=False)),
                ("authority_fingerprint", models.CharField(editable=False, max_length=64)),
                (
                    "file",
                    models.FileField(
                        editable=False,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=shareholders.models.publication.publication_file_path,
                    ),
                ),
                ("mime_type", models.CharField(blank=True, editable=False, max_length=100)),
                ("digest", models.CharField(blank=True, editable=False, max_length=64)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False)),
                ("register_head_hash", models.CharField(editable=False, max_length=64)),
                ("member_rows", models.PositiveIntegerField(editable=False)),
                ("audience_digest", models.CharField(editable=False, max_length=64)),
                ("prepared_by_id", models.PositiveBigIntegerField(editable=False)),
                ("question", models.TextField(blank=True, editable=False)),
                (
                    "resolution_kind",
                    models.CharField(
                        blank=True,
                        choices=[("ordinary", "Ordinary resolution"), ("special", "Special resolution")],
                        editable=False,
                        max_length=16,
                    ),
                ),
                (
                    "vote_basis",
                    models.CharField(
                        blank=True, choices=[("per_share", "One vote per share")], editable=False, max_length=16
                    ),
                ),
                ("opens_at", models.DateTimeField(blank=True, editable=False, null=True, verbose_name="voting opens")),
                (
                    "closes_at",
                    models.DateTimeField(blank=True, editable=False, null=True, verbose_name="voting closes"),
                ),
                (
                    "rate_per_share",
                    models.DecimalField(blank=True, decimal_places=6, editable=False, max_digits=18, null=True),
                ),
                (
                    "currency",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("AUD", "Australian Dollar"),
                            ("USD", "US Dollar"),
                            ("EUR", "Euro"),
                            ("GBP", "British Pound"),
                            ("CAD", "Canadian Dollar"),
                            ("JPY", "Japanese Yen"),
                            ("NZD", "New Zealand Dollar"),
                            ("SGD", "Singapore Dollar"),
                        ],
                        editable=False,
                        max_length=16,
                    ),
                ),
                (
                    "declared_on",
                    models.DateField(blank=True, editable=False, null=True, verbose_name="dividend declared on"),
                ),
                ("payment_date", models.DateField(blank=True, editable=False, null=True)),
                (
                    "declared_total",
                    models.DecimalField(blank=True, decimal_places=2, editable=False, max_digits=18, null=True),
                ),
                (
                    "undistributed",
                    models.DecimalField(blank=True, decimal_places=2, editable=False, max_digits=18, null=True),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="publications", to="companies.company"
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
    ]
