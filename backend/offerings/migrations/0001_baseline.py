import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("offerings", "0001_initial"),
        ("offerings", "0002_subscription"),
        ("offerings", "0003_subscription_tx_hash_case_insensitive"),
        ("offerings", "0004_protect_the_offering_token"),
        ("offerings", "0005_r0_owner_columns"),
        ("offerings", "0006_trigger_follows_and_refuses"),
        ("offerings", "0007_subscription_step_times"),
        ("offerings", "0008_subscription_snapshots"),
        ("offerings", "0009_published_documents_stay"),
    ]

    initial = True

    dependencies = [
        ("assets", "0001_baseline"),
        ("authentication", "__first__"),
        ("companies", "0001_baseline"),
    ]

    operations = [
        migrations.CreateModel(
            name="Subscription",
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
                ("currency", models.CharField(editable=False, max_length=16)),
                ("quantity", models.PositiveIntegerField()),
                ("allotted_quantity", models.PositiveIntegerField(blank=True, null=True)),
                ("price_per_share", models.DecimalField(decimal_places=2, max_digits=18)),
                ("amount_due", models.DecimalField(decimal_places=2, max_digits=18)),
                (
                    "settlement_rail",
                    models.CharField(
                        choices=[("bank_transfer", "Bank transfer"), ("stablecoin", "Stablecoin")],
                        default="bank_transfer",
                        max_length=20,
                    ),
                ),
                ("settlement_amount", models.BigIntegerField(blank=True, null=True)),
                ("reference", models.CharField(blank=True, max_length=18)),
                ("payment_instruction_issued_at", models.DateTimeField(blank=True, null=True)),
                ("payment_due_at", models.DateTimeField(blank=True, null=True)),
                ("amount_received", models.DecimalField(blank=True, decimal_places=2, max_digits=18, null=True)),
                ("payment_received_on", models.DateField(blank=True, null=True)),
                ("payment_reference_seen", models.CharField(blank=True, max_length=140)),
                ("payment_tx_hash", models.CharField(blank=True, max_length=66)),
                ("payment_confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("payment_notes", models.TextField(blank=True)),
                ("refund_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=18, null=True)),
                ("refunded_at", models.DateTimeField(blank=True, null=True)),
                ("refund_reference", models.CharField(blank=True, max_length=140)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted"),
                            ("accepted", "Accepted"),
                            ("awaiting_payment", "Awaiting Payment"),
                            ("paid", "Paid"),
                            ("allotted", "Allotted"),
                            ("rejected", "Rejected"),
                            ("withdrawn", "Withdrawn"),
                            ("refunded", "Refunded"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                ("allotted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "closed_at",
                    models.DateTimeField(blank=True, help_text="When it was rejected or withdrawn", null=True),
                ),
            ],
            options={
                "verbose_name": "Subscription",
                "verbose_name_plural": "Subscriptions",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Offering",
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
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted for Review"),
                            ("under_review", "Under Review"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("closed", "Closed"),
                            ("withdrawn", "Withdrawn"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                (
                    "exemption",
                    models.CharField(
                        choices=[
                            ("s708_8_minimum_amount", "Minimum amount of AUD 500,000 (s708(8)(a))"),
                            ("s708_8_net_assets", "Net assets certified by a qualified accountant (s708(8)(c))"),
                            ("s708_8_gross_income", "Gross income certified by a qualified accountant (s708(8)(c))"),
                            ("s708_11_professional", "Professional investor (s708(11))"),
                            ("s761g_wholesale_client", "Wholesale client (s761G)"),
                        ],
                        max_length=30,
                    ),
                ),
                ("price_per_share", models.DecimalField(decimal_places=2, max_digits=18)),
                (
                    "price_currency",
                    models.CharField(
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
                        default="AUD",
                        max_length=16,
                    ),
                ),
                ("accepts_bank_transfer", models.BooleanField(default=True)),
                ("minimum_shares", models.PositiveIntegerField()),
                ("target_shares", models.PositiveIntegerField()),
                ("cap_shares", models.PositiveIntegerField()),
                ("maximum_shares", models.PositiveIntegerField(blank=True, null=True)),
                ("opens_at", models.DateTimeField()),
                ("closes_at", models.DateTimeField(blank=True, null=True)),
                ("summary", models.TextField(blank=True)),
                ("use_of_proceeds", models.TextField(blank=True)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("review_notes", models.TextField(blank=True)),
                ("rejection_reason", models.TextField(blank=True)),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                ("close_reason", models.TextField(blank=True)),
                (
                    "company",
                    models.ForeignKey(
                        help_text="Owner, derived from token.company and held directly so a row-level security policy can read it",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.company",
                    ),
                ),
                (
                    "documents",
                    models.ManyToManyField(blank=True, related_name="offerings", to="companies.companydocument"),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="reviewed_offerings",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "settlement_assets",
                    models.ManyToManyField(
                        blank=True,
                        limit_choices_to={"asset_type": "stablecoin"},
                        related_name="offerings",
                        to="assets.asset",
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="submitted_offerings",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Offering",
                "verbose_name_plural": "Offerings",
                "ordering": ["-created_at"],
            },
        ),
    ]
