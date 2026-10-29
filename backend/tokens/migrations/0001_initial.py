import uuid
from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.member_certificate
import tokens.models.register_allotment
import tokens.models.register_award
import tokens.models.register_capital_increase
import tokens.models.register_correction
import tokens.models.register_evidence
import tokens.models.register_grant
import tokens.models.register_import
import tokens.models.register_instruction
import tokens.models.register_opening
import tokens.models.register_particulars
import tokens.models.register_pause_change
import tokens.models.register_transfer


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("assets", "0001_initial"),
        ("blockchain", "0001_initial"),
        ("companies", "0002_initial"),
        ("users", "0001_initial"),
        ("wallets", "0001_initial"),
        ("whitelist", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterExport",
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
                ("requested_by_id", models.PositiveBigIntegerField(editable=False)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("register_csv", "Register CSV"),
                            ("inspection_copy", "Inspection copy"),
                            ("certificate", "Certificate"),
                            ("notice_figures", "Notice figures"),
                            ("company_pack", "Company pack"),
                        ],
                        editable=False,
                        max_length=24,
                    ),
                ),
                ("register_sequence", models.PositiveBigIntegerField(editable=False)),
                ("member_rows", models.PositiveIntegerField(editable=False)),
                ("former_rows", models.PositiveIntegerField(editable=False)),
                ("digest", models.CharField(blank=True, editable=False, max_length=64)),
                ("instruction", models.CharField(blank=True, editable=False, max_length=255)),
                ("requested_on", models.DateField(editable=False, null=True)),
                ("recipient", models.CharField(blank=True, editable=False, max_length=255)),
                ("late", models.BooleanField(editable=False, null=True)),
                ("period_from", models.DateField(editable=False, null=True)),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterReconciliation",
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
                        choices=[("matched", "Matched"), ("discrepant", "Discrepant"), ("failed", "Failed")],
                        editable=False,
                        max_length=12,
                    ),
                ),
                ("block_number", models.PositiveBigIntegerField(editable=False, null=True)),
                ("block_hash", models.CharField(blank=True, editable=False, max_length=66)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False, null=True)),
                ("discrepancies", models.JSONField(default=list, editable=False)),
                ("failure", models.CharField(blank=True, editable=False, max_length=500)),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="YieldToken",
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
                ("name", models.CharField(max_length=100)),
                ("symbol", models.CharField(max_length=10, unique=True)),
                ("contract_address", models.CharField(max_length=42, unique=True)),
                ("decimals", models.PositiveSmallIntegerField(default=6)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "nav_per_token",
                    models.DecimalField(
                        blank=True,
                        decimal_places=6,
                        help_text="Current NAV per token in USD (e.g., 1.005000)",
                        max_digits=20,
                        null=True,
                    ),
                ),
                (
                    "total_reserve_value",
                    models.DecimalField(
                        blank=True,
                        decimal_places=6,
                        help_text="Synthetic reference value in USD; not evidence of a real reserve",
                        max_digits=20,
                        null=True,
                    ),
                ),
                (
                    "last_nav_update",
                    models.DateTimeField(blank=True, help_text="Timestamp of last NAV update", null=True),
                ),
            ],
            options={
                "verbose_name": "Yield Token",
                "verbose_name_plural": "Yield Tokens",
                "ordering": ["symbol"],
            },
        ),
        migrations.CreateModel(
            name="CapitalIncreaseRequest",
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
                            ("submitted", "Submitted"),
                            ("under_review", "Under Review"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("executing", "Executing"),
                            ("executed", "Executed"),
                            ("failed", "Failed"),
                            ("superseded", "Superseded"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                (
                    "dilution_percentage",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="Percentage dilution this request would cause to existing holders",
                        max_digits=5,
                        null=True,
                    ),
                ),
                (
                    "submitted_at",
                    models.DateTimeField(blank=True, help_text="When the request was submitted", null=True),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, help_text="When the request was reviewed", null=True)),
                (
                    "review_notes",
                    models.TextField(
                        blank=True,
                        help_text="Reviewer notes; older entries may also contain historical execution messages",
                    ),
                ),
                (
                    "execution_notes",
                    models.TextField(
                        blank=True,
                        help_text="What each execution attempt did, in order. Written by the system; review_notes is the person's",
                    ),
                ),
                ("rejection_reason", models.TextField(blank=True, help_text="Reason for rejection (if rejected)")),
                (
                    "executed_at",
                    models.DateTimeField(blank=True, help_text="When the request was executed on-chain", null=True),
                ),
                ("dispatch_id", models.UUIDField(default=uuid.uuid4, editable=False, null=True)),
                (
                    "additional_shares",
                    models.PositiveIntegerField(
                        help_text="Number of additional shares to authorize; execution does not mint shares"
                    ),
                ),
                (
                    "new_authorized_total",
                    models.PositiveIntegerField(help_text="New total authorized shares after increase"),
                ),
                ("purpose", models.TextField(help_text="Purpose or justification for this capital increase")),
                (
                    "board_resolution_reference",
                    models.CharField(
                        help_text="Reference to board resolution authorizing this increase", max_length=255
                    ),
                ),
                (
                    "shareholder_approval_reference",
                    models.CharField(
                        blank=True, help_text="Reference to shareholder approval (if required)", max_length=255
                    ),
                ),
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
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="Staff member who reviewed the request",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="reviewed_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="User who submitted the request",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="submitted_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Capital Increase Request",
                "verbose_name_plural": "Capital Increase Requests",
                "ordering": ["-created_at"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="MemberInvitation",
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
                ("intended_email", models.CharField(max_length=254)),
                ("source_snapshot", models.JSONField()),
                ("acceptance_deadline", models.DateTimeField()),
                ("code_sha256", models.CharField(editable=False, max_length=64, unique=True)),
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
                        related_name="member_invitations",
                        to="companies.company",
                    ),
                ),
                (
                    "issued_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="MemberAssociation",
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
                ("accepted_email", models.CharField(max_length=254)),
                ("current", models.BooleanField(default=True, editable=False)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_associations",
                        to="companies.company",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_associations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_associations",
                        to="users.useraccount",
                    ),
                ),
                (
                    "invitation",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="association",
                        to="tokens.memberinvitation",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="MemberParticularsRequest",
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
                ("source_snapshot", models.JSONField()),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.CharField(max_length=1000)),
                (
                    "association",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars_requests",
                        to="tokens.memberassociation",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_particulars_requests",
                        to="companies.company",
                    ),
                ),
                (
                    "requested_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
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
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
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
                ("company_event_on", models.DateField(null=True)),
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
                (
                    "agreement",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="allotment",
                        to="tokens.registeragreement",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_allotments",
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
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "completion_approval_appointment",
                    models.ForeignKey(
                        editable=False,
                        null=True,
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
                    "register_allotment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerallotment",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
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
        migrations.CreateModel(
            name="RegisterCapitalIncrease",
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
                ("snapshot", models.JSONField(editable=False)),
                ("intent", models.JSONField(editable=False)),
                ("intent_digest", models.CharField(editable=False, max_length=64)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_capital_increase.capital_evidence_path,
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
                        related_name="register_capital_increases",
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
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="company_instruction",
                        to="tokens.capitalincreaserequest",
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="CapitalIncreaseExecution",
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
                ("request_id", models.UUIDField(editable=False, unique=True)),
                ("token_id", models.UUIDField(editable=False)),
                ("company_id", models.UUIDField(editable=False)),
                ("executed_by_id", models.PositiveBigIntegerField(editable=False)),
                ("intent", models.JSONField(editable=False)),
                ("retry_of", models.UUIDField(editable=False, null=True)),
                ("attribution_evidence", models.JSONField(editable=False, null=True)),
                ("projected_at", models.DateTimeField(editable=False, null=True)),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="capital_increase",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="capital_increases",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
                (
                    "source_increase",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="executions",
                        to="tokens.registercapitalincrease",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.CreateModel(
            name="RegisterCapitalIncreaseDecision",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "capital_increase",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registercapitalincrease",
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registercapitalincreasedecision",
            ),
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
                (
                    "agreement",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="contribution",
                        to="tokens.registeragreement",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="contribution",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="allotment", to="tokens.registercontribution"
            ),
        ),
        migrations.CreateModel(
            name="RegisterCorrection",
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
                ("base_sequence", models.PositiveBigIntegerField()),
                ("base_hash", models.CharField(max_length=64)),
                ("effective_on", models.DateField()),
                ("changes", models.JSONField()),
                (
                    "authority",
                    models.CharField(
                        choices=[("director_resolution", "Director resolution"), ("court_order", "Court order")],
                        max_length=24,
                    ),
                ),
                ("approving_director", models.CharField(blank=True, max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField(null=True)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_correction.correction_evidence_path,
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
                        related_name="register_corrections",
                        to="companies.company",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        null=True,
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
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
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_correction",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registercorrection",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterDeployment",
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
                ("snapshot", models.JSONField()),
                ("intent", models.JSONField()),
                ("intent_digest", models.CharField(max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("deployment_id", models.UUIDField(editable=False, null=True, unique=True)),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_deployments",
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterDeploymentDecision",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_deployment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerdeployment",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerdeploymentdecision",
            ),
        ),
        migrations.CreateModel(
            name="RegisterEntry",
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
                ("operation_id", models.UUIDField()),
                ("sequence", models.PositiveBigIntegerField(default=0, editable=False)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("opening", "Opening state"),
                            ("issue", "Issue"),
                            ("transfer", "Transfer"),
                            ("cessation", "Cessation"),
                            ("correction", "Compensating correction"),
                            ("mirror_correction", "Mirror snapshot correction"),
                        ],
                        max_length=24,
                    ),
                ),
                ("effective_on", models.DateField()),
                ("changes", models.JSONField()),
                ("previous_hash", models.CharField(blank=True, editable=False, max_length=64)),
                ("entry_hash", models.CharField(blank=True, editable=False, max_length=64)),
                (
                    "corrects",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="correction",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["sequence"],
            },
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="applied_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="approved_correction",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="corrects",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="proposals", to="tokens.registerentry"
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
        migrations.CreateModel(
            name="MemberCertificateRequest",
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
                (
                    "association",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="certificate_requests",
                        to="tokens.memberassociation",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_certificate_requests",
                        to="companies.company",
                    ),
                ),
                (
                    "requested_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_certificate_requests",
                        to="tokens.registerentry",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
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
                        choices=[
                            ("share_register", "Share register"),
                            ("asic_extract", "ASIC extract"),
                            ("authority", "Authority document"),
                            ("supporting", "Supporting document"),
                            ("class_rights", "Class document"),
                        ],
                        max_length=16,
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
            model_name="registercorrection",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
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
            model_name="registercapitalincrease",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
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
                (
                    "evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
            ],
            options={
                "ordering": ["-company_event_on", "-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="registerawardvesting",
            name="evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
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
                    "evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
            ],
            options={
                "ordering": ["-company_event_on", "-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="registeraward",
            name="agreement_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
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
            model_name="registeragreement",
            name="evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.CreateModel(
            name="MemberCertificateFulfilment",
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
                ("instruction", models.CharField(max_length=255)),
                ("source_snapshot", models.JSONField()),
                ("source_digest", models.CharField(max_length=64)),
                ("digest", models.CharField(max_length=64)),
                ("file_size", models.PositiveBigIntegerField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.member_certificate.member_certificate_path,
                    ),
                ),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "produced_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="fulfilment",
                        to="tokens.membercertificaterequest",
                    ),
                ),
                (
                    "export",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_fulfilment",
                        to="tokens.registerexport",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
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
                ("company_event_on", models.DateField(null=True)),
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
                (
                    "acceptance_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "authority_evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
                (
                    "award",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="grants",
                        to="tokens.registeraward",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_grants",
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
                    "register_entry",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="grant",
                        to="tokens.registerentry",
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
                    "terms_evidence",
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
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_grant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registergrant"
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterImport",
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
                ("as_at", models.DateField()),
                ("source_reference", models.CharField(blank=True, default="", max_length=255)),
                ("source_confirmed", models.BooleanField(default=False)),
                ("base_sequence", models.PositiveBigIntegerField(editable=False, null=True)),
                ("base_hash", models.CharField(blank=True, default="", editable=False, max_length=64)),
                ("members", models.JSONField()),
                ("former_members", models.JSONField()),
                (
                    "authority",
                    models.CharField(
                        choices=[
                            ("director_resolution", "Director resolution"),
                            ("court_order", "Court order"),
                            ("company_records", "Company records"),
                        ],
                        max_length=24,
                    ),
                ),
                ("approving_director", models.CharField(blank=True, max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField(null=True)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField(null=True)),
                (
                    "file",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_import.import_evidence_path,
                    ),
                ),
                ("asic_document", models.UUIDField(null=True)),
                ("asic_fingerprint", models.CharField(max_length=64)),
                ("asic_snapshot", models.JSONField(null=True)),
                (
                    "asic_file",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_import.import_evidence_path,
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
                ("asic_issued_total", models.DecimalField(decimal_places=0, editable=False, max_digits=78, null=True)),
                ("asic_member_count", models.PositiveIntegerField(editable=False, null=True)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False, null=True)),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "asic_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_imports",
                        to="companies.company",
                    ),
                ),
                (
                    "correction_of",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="corrections",
                        to="tokens.registerimport",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyappointment",
                    ),
                ),
                (
                    "register_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
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
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_import",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerimport",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterInstruction",
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
                ("kind", models.CharField(choices=[("issue", "Issue"), ("transfer", "Transfer")], max_length=16)),
                ("items", models.JSONField()),
                ("approving_director", models.CharField(max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField(null=True)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_instruction.instruction_evidence_path,
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
                ("terms_on", models.DateField(null=True)),
                ("terms", models.CharField(max_length=1000, null=True)),
                ("acceptance_required", models.BooleanField(null=True)),
                ("terms_fingerprint", models.CharField(max_length=64, null=True)),
                ("terms_snapshot", models.JSONField(null=True)),
                (
                    "terms_file",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        null=True,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_instruction.instruction_evidence_path,
                    ),
                ),
                ("acceptance_fingerprint", models.CharField(max_length=64, null=True)),
                ("acceptance_snapshot", models.JSONField(null=True)),
                (
                    "acceptance_file",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        null=True,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_instruction.instruction_evidence_path,
                    ),
                ),
                ("snapshot", models.JSONField(editable=False, null=True)),
                ("intent", models.JSONField(editable=False, null=True)),
                ("intent_digest", models.CharField(editable=False, max_length=64, null=True)),
                (
                    "acceptance_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "authority_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_instructions",
                        to="companies.company",
                    ),
                ),
                (
                    "nomination",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="whitelist.companywalletnomination",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        null=True,
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
                    "terms_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "wallet_approval",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="whitelist.whitelistchange",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterInstructionDecision",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "instruction",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerinstruction",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerinstructiondecision",
            ),
        ),
        migrations.CreateModel(
            name="RegisterMember",
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
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_members",
                        to="companies.company",
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="member",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registermember"
            ),
        ),
        migrations.CreateModel(
            name="RegisterMemberWallet",
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
                ("address", models.CharField(max_length=42)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_wallets",
                        to="companies.company",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="wallets", to="tokens.registermember"
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="RegisterOpening",
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
                ("mapping", models.JSONField()),
                ("boundary", models.JSONField(null=True)),
                (
                    "authority",
                    models.CharField(
                        choices=[("director_resolution", "Director resolution"), ("court_order", "Court order")],
                        max_length=24,
                    ),
                ),
                ("approving_director", models.CharField(blank=True, max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField(null=True)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_opening.opening_evidence_path,
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
                    "applied_entry",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="approved_opening",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "authority_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_openings",
                        to="companies.company",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        null=True,
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterOpeningDecision",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_opening",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registeropening",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
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
                    "member_request",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="change",
                        to="tokens.memberparticularsrequest",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
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
            },
        ),
        migrations.CreateModel(
            name="RegisterPauseChange",
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
                ("paused", models.BooleanField(editable=False)),
                ("reason", models.CharField(editable=False, max_length=1000)),
                ("authority_reference", models.CharField(editable=False, max_length=255)),
                ("snapshot", models.JSONField(editable=False)),
                ("intent", models.JSONField(editable=False)),
                ("intent_digest", models.CharField(editable=False, max_length=64)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_pause_change.pause_evidence_path,
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
                    "authority_evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_pause_changes",
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="PauseChange",
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
                ("token_id", models.UUIDField(editable=False)),
                ("company_id", models.UUIDField(editable=False)),
                (
                    "authority",
                    models.CharField(
                        choices=[("issuer", "Issuer"), ("staff", "Token administration"), ("company", "Company")],
                        editable=False,
                        max_length=7,
                    ),
                ),
                ("paused", models.BooleanField(editable=False)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("contract_address", models.CharField(editable=False, max_length=42)),
                ("intent", models.JSONField(editable=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Checking the requested state"),
                            ("executing", "Transaction outcome unresolved"),
                            ("observed", "Already in the requested state"),
                            ("confirmed", "Original transaction confirmed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=10,
                    ),
                ),
                ("observation", models.JSONField(editable=False, null=True)),
                ("completed_at", models.DateTimeField(editable=False, null=True)),
                (
                    "initiated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pause_change",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "source_pause",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="execution",
                        to="tokens.registerpausechange",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="RegisterPauseChangeDecision",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "pause_change",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerpausechange",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerpausechangedecision",
            ),
        ),
        migrations.CreateModel(
            name="RegisterPersonRegistration",
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
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="person_registrations",
                        to="companies.company",
                    ),
                ),
                (
                    "member",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="registration",
                        to="tokens.registermember",
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
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterAcknowledgement",
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
                ("token_id", models.UUIDField(editable=False)),
                ("discrepancy", models.JSONField(editable=False)),
                ("reason", models.CharField(editable=False, max_length=1000)),
                ("acknowledged_by_id", models.PositiveBigIntegerField(editable=False)),
                ("idempotency_key", models.UUIDField(editable=False)),
                (
                    "appointment",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyappointment",
                    ),
                ),
                (
                    "reconciliation",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="acknowledgements",
                        to="tokens.registerreconciliation",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at", "uuid"],
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
                ("company_event_on", models.DateField(null=True)),
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
                (
                    "authority_evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_transfers",
                        to="companies.company",
                    ),
                ),
                (
                    "instrument_evidence",
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
                    "register_entry",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="direct_transfer",
                        to="tokens.registerentry",
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterMemberParticulars",
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
                (
                    "member",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "source_allotment",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registerallotment",
                    ),
                ),
                (
                    "source_award",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registeraward",
                    ),
                ),
                (
                    "source_grant",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registergrant",
                    ),
                ),
                (
                    "source_import",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registerimport",
                    ),
                ),
                (
                    "source_change",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registerparticularschange",
                    ),
                ),
                (
                    "source_registration",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registerpersonregistration",
                    ),
                ),
                (
                    "source_transfer",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="particulars",
                        to="tokens.registertransfer",
                    ),
                ),
            ],
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
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "completion_approval_appointment",
                    models.ForeignKey(
                        editable=False,
                        null=True,
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
                    "register_transfer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registertransfer",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterWalletLink",
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
                ("mapping", models.JSONField()),
                (
                    "authority",
                    models.CharField(
                        choices=[("director_resolution", "Director resolution"), ("court_order", "Court order")],
                        max_length=24,
                    ),
                ),
                ("approving_director", models.CharField(blank=True, max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField(null=True)),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_opening.link_evidence_path,
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
                    "authority_evidence",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_wallet_links",
                        to="companies.company",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        null=True,
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterWalletLinkDecision",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_wallet_link",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerwalletlink",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="ShareIssuance",
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
                    "recipient_address",
                    models.CharField(help_text="Ethereum address receiving the shares (0x...)", max_length=42),
                ),
                (
                    "recipient_name",
                    models.CharField(
                        blank=True,
                        help_text="The holder's name as it stood when the shares were allotted",
                        max_length=255,
                    ),
                ),
                (
                    "recipient_residential_address",
                    models.TextField(
                        blank=True,
                        help_text="The holder's residential address as it stood when the shares were allotted",
                    ),
                ),
                (
                    "identity_stamped_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="When the recipient name and address were stamped, or null if they never were",
                        null=True,
                    ),
                ),
                (
                    "amount",
                    models.CharField(help_text="Number of shares issued (as string for large numbers)", max_length=78),
                ),
                (
                    "issuance_type",
                    models.CharField(
                        choices=[
                            ("initial", "Initial Issuance"),
                            ("additional", "Additional Issuance"),
                            ("bonus", "Bonus Shares"),
                            ("dividend", "Dividend Reinvestment"),
                            ("transfer", "Transfer (Re-issuance)"),
                        ],
                        default="additional",
                        max_length=20,
                    ),
                ),
                ("reason", models.TextField(blank=True, help_text="Reason or notes for the issuance")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("processing", "Processing"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("error_message", models.TextField(blank=True, help_text="Error details if issuance failed")),
                (
                    "tx_hash",
                    models.CharField(
                        blank=True,
                        help_text="Fixed mint transaction hash, recorded before submission for journaled issuances",
                        max_length=66,
                        null=True,
                    ),
                ),
                (
                    "mint_journal",
                    models.JSONField(
                        blank=True,
                        editable=False,
                        help_text="Signed mint attempts retained for replay; null identifies a legacy issuance without a journal",
                        null=True,
                    ),
                ),
                (
                    "block_number",
                    models.PositiveBigIntegerField(
                        blank=True, help_text="Block number where transaction was mined (legacy field)", null=True
                    ),
                ),
                (
                    "gas_used",
                    models.PositiveBigIntegerField(
                        blank=True, help_text="Gas used by the transaction (legacy field)", null=True
                    ),
                ),
                (
                    "processed_at",
                    models.DateTimeField(
                        blank=True, help_text="When the blockchain transaction was submitted", null=True
                    ),
                ),
                (
                    "completed_at",
                    models.DateTimeField(
                        blank=True, help_text="When the blockchain transaction was confirmed", null=True
                    ),
                ),
                (
                    "idempotency_key",
                    models.CharField(
                        blank=True,
                        help_text="Unique key to prevent duplicate issuances",
                        max_length=64,
                        null=True,
                        unique=True,
                    ),
                ),
                (
                    "initiated_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="User who initiated the issuance",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="initiated_issuances",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="share_issuances",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "verbose_name": "Share Issuance",
                "verbose_name_plural": "Share Issuances",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="capitalincreaserequest",
            name="executed_issuance",
            field=models.OneToOneField(
                blank=True,
                help_text="The executed ShareIssuance record for the minted shares",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s",
                to="tokens.shareissuance",
            ),
        ),
        migrations.CreateModel(
            name="ShareIssuanceExecution",
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
                ("request_id", models.UUIDField(editable=False, unique=True)),
                ("token_id", models.UUIDField(editable=False)),
                ("company_id", models.UUIDField(editable=False)),
                ("issuance_id", models.UUIDField(editable=False, null=True, unique=True)),
                ("executed_by_id", models.PositiveBigIntegerField(editable=False)),
                ("authority", models.CharField(editable=False, max_length=64)),
                ("intent", models.JSONField(editable=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("executing", "Executing"),
                            ("executed", "Executed"),
                            ("failed", "Failed before signing or reverted"),
                        ],
                        default="queued",
                        max_length=12,
                    ),
                ),
                ("finalized_receipt", models.JSONField(editable=False, null=True)),
                ("retry_of", models.UUIDField(editable=False, null=True)),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="share_issuance",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "source_instruction",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="executions",
                        to="tokens.registerinstruction",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="issuance_executions",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.CreateModel(
            name="ShareIssuanceRequest",
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
                    "dilution_percentage",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="Percentage dilution this request would cause to existing holders",
                        max_digits=5,
                        null=True,
                    ),
                ),
                (
                    "submitted_at",
                    models.DateTimeField(blank=True, help_text="When the request was submitted", null=True),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, help_text="When the request was reviewed", null=True)),
                (
                    "review_notes",
                    models.TextField(
                        blank=True,
                        help_text="Reviewer notes; older entries may also contain historical execution messages",
                    ),
                ),
                (
                    "execution_notes",
                    models.TextField(
                        blank=True,
                        help_text="What each execution attempt did, in order. Written by the system; review_notes is the person's",
                    ),
                ),
                ("rejection_reason", models.TextField(blank=True, help_text="Reason for rejection (if rejected)")),
                (
                    "executed_at",
                    models.DateTimeField(blank=True, help_text="When the request was executed on-chain", null=True),
                ),
                ("dispatch_id", models.UUIDField(default=uuid.uuid4, editable=False, null=True)),
                ("recipient_address", models.CharField(help_text="Ethereum address of the recipient", max_length=42)),
                (
                    "recipient_name",
                    models.CharField(blank=True, help_text="Name of the recipient (optional)", max_length=255),
                ),
                ("amount", models.PositiveIntegerField(help_text="Number of shares to issue")),
                (
                    "issuance_type",
                    models.CharField(
                        choices=[
                            ("initial", "Initial Issuance"),
                            ("additional", "Additional Issuance"),
                            ("bonus", "Bonus Shares"),
                            ("dividend", "Dividend Reinvestment"),
                            ("transfer", "Transfer (Re-issuance)"),
                        ],
                        default="additional",
                        help_text="Type of issuance",
                        max_length=20,
                    ),
                ),
                ("reason", models.TextField(help_text="Purpose or justification for this issuance")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted"),
                            ("under_review", "Under Review"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("executing", "Executing"),
                            ("executed", "Executed"),
                            ("failed", "Failed"),
                            ("superseded", "Superseded"),
                        ],
                        default="submitted",
                        max_length=20,
                    ),
                ),
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
                    "executed_issuance",
                    models.OneToOneField(
                        blank=True,
                        help_text="The executed ShareIssuance record for the minted shares",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s",
                        to="tokens.shareissuance",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="Staff member who reviewed the request",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="reviewed_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="User who submitted the request",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="submitted_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Share Issuance Request",
                "verbose_name_plural": "Share Issuance Requests",
                "ordering": ["-created_at"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="request",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_instruction",
                to="tokens.shareissuancerequest",
            ),
        ),
        migrations.CreateModel(
            name="ShareRegister",
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
                    "head_hash",
                    models.CharField(
                        default="0000000000000000000000000000000000000000000000000000000000000000",
                        editable=False,
                        max_length=64,
                    ),
                ),
                ("issued_supply", models.DecimalField(decimal_places=0, default=0, editable=False, max_digits=78)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="registers", to="companies.company"
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterPosition",
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
                ("shares", models.DecimalField(decimal_places=0, editable=False, max_digits=78)),
                ("entered_on", models.DateField(editable=False)),
                (
                    "last_entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerentry"
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="positions",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "register",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="positions", to="tokens.shareregister"
                    ),
                ),
            ],
        ),
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
                ("returned_on", models.DateField(null=True)),
                ("returned_at", models.DateTimeField(null=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_cessations",
                        to="companies.company",
                    ),
                ),
                (
                    "entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_cessations",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="cessations",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "returned_entry",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_returns",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "register",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_cessations",
                        to="tokens.shareregister",
                    ),
                ),
            ],
            options={
                "ordering": ["-ceased_on", "-entry__sequence", "member_id"],
            },
        ),
        migrations.AddField(
            model_name="registerentry",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="entries", to="tokens.shareregister"
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="corrections", to="tokens.shareregister"
            ),
        ),
        migrations.CreateModel(
            name="ShareToken",
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
                ("deployment_id", models.UUIDField(editable=False, null=True)),
                (
                    "former_holders_folded_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="When the former-members fold last succeeded for this share class",
                        null=True,
                    ),
                ),
                (
                    "former_holders_block",
                    models.BigIntegerField(
                        blank=True,
                        help_text="The block the former-members fold last read up to, which the export reports beside its date",
                        null=True,
                    ),
                ),
                ("name", models.CharField(max_length=100)),
                ("symbol", models.CharField(max_length=10)),
                (
                    "token_type",
                    models.CharField(
                        choices=[("ordinary", "Ordinary"), ("preference", "Preference"), ("redeemable", "Redeemable")],
                        default="ordinary",
                        max_length=20,
                    ),
                ),
                ("total_supply", models.CharField(max_length=78)),
                (
                    "decimals",
                    models.PositiveSmallIntegerField(
                        default=0, validators=[django.core.validators.MaxValueValidator(0)]
                    ),
                ),
                ("is_transferable", models.BooleanField(default=True)),
                ("is_divisible", models.BooleanField(default=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("deploying", "Deploying"),
                            ("deployed", "Deployed"),
                            ("paused", "Paused"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                ("contract_address", models.CharField(blank=True, max_length=42, null=True, unique=True)),
                (
                    "chain",
                    models.CharField(
                        blank=True,
                        help_text="Blockchain the contract was deployed to (null until deployment confirms)",
                        max_length=32,
                        null=True,
                    ),
                ),
                (
                    "deployment_tx_hash",
                    models.CharField(
                        blank=True, help_text="Transaction hash of deployment (legacy field)", max_length=66, null=True
                    ),
                ),
                ("deployed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="tokens", to="companies.company"
                    ),
                ),
                (
                    "deployment_transaction",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="deployed_share_tokens",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "verbose_name": "Share Token",
                "verbose_name_plural": "Share Tokens",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="shareregister",
            name="token",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="stored_register", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="shareissuancerequest",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="issuance_requests", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="shareissuance",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="issuances", to="tokens.sharetoken"
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
            model_name="registerreconciliation",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_reconciliations",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_pause_changes",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_openings", to="tokens.sharetoken"
            ),
        ),
        migrations.CreateModel(
            name="RegisterMemberDocument",
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
                    "category",
                    models.CharField(
                        choices=[
                            ("share_certificate", "Share certificate"),
                            ("shareholder_agreement", "Shareholder agreement"),
                            ("subscription_agreement", "Subscription agreement"),
                            ("other", "Other supporting document"),
                        ],
                        max_length=24,
                    ),
                ),
                ("snapshot", models.JSONField()),
                ("idempotency_key", models.UUIDField()),
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
                        related_name="member_documents",
                        to="companies.company",
                    ),
                ),
                (
                    "evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="documents",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "source_import",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="tokens.registerimport",
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_instructions",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_imports", to="tokens.sharetoken"
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
            model_name="registerexport",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.DO_NOTHING, related_name="register_exports", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_deployments", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_capital_increases",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registeraward",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_awards", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registerallotment",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_allotments", to="tokens.sharetoken"
            ),
        ),
        migrations.CreateModel(
            name="OrderSubmission",
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
                ("submission_id", models.UUIDField(editable=False)),
                ("intent_version", models.PositiveSmallIntegerField(default=1, editable=False)),
                ("wallet_address", models.CharField(editable=False, max_length=42)),
                (
                    "order_type",
                    models.CharField(choices=[("buy", "Buy"), ("sell", "Sell")], editable=False, max_length=10),
                ),
                ("quantity", models.PositiveBigIntegerField(editable=False)),
                ("min_quantity", models.PositiveBigIntegerField(default=0, editable=False)),
                ("price_per_share", models.DecimalField(decimal_places=2, editable=False, max_digits=18)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("verifying_contract", models.CharField(editable=False, max_length=42)),
                ("token_metadata", models.JSONField(editable=False)),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("created", "Created"), ("refused", "Refused")],
                        default="pending",
                        max_length=7,
                    ),
                ),
                ("refusal_code", models.CharField(blank=True, max_length=32)),
                ("refusal_detail", models.CharField(blank=True, max_length=200)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                (
                    "eligibility_decision",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "initiated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "owner_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="wallets.wallet"
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.sharetoken"
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="OrderActionSubmission",
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
                ("action_id", models.UUIDField(editable=False)),
                ("protocol_version", models.PositiveSmallIntegerField(default=1, editable=False)),
                (
                    "purpose",
                    models.CharField(
                        choices=[("cancel", "Cancel"), ("modify", "Modify")], editable=False, max_length=6
                    ),
                ),
                ("eligibility_admitted_at", models.DateTimeField(blank=True, null=True)),
                ("wallet_address", models.CharField(editable=False, max_length=42)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("verifying_contract", models.CharField(editable=False, max_length=42)),
                ("token_metadata", models.JSONField(editable=False)),
                ("review_values", models.JSONField(editable=False)),
                ("new_quantity", models.PositiveBigIntegerField(editable=False, null=True)),
                ("new_min_quantity", models.PositiveBigIntegerField(editable=False, null=True)),
                (
                    "new_price_per_share",
                    models.DecimalField(decimal_places=2, editable=False, max_digits=18, null=True),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("applied", "Applied"), ("refused", "Refused")],
                        default="pending",
                        max_length=7,
                    ),
                ),
                ("result", models.JSONField(blank=True, null=True)),
                ("refusal_code", models.CharField(blank=True, max_length=64)),
                ("refusal_detail", models.CharField(blank=True, max_length=512)),
                ("refusal_status", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                (
                    "eligibility_decision",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "executed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "initiated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "owner_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="wallets.wallet"
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.sharetoken"
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="membercertificaterequest",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="member_certificate_requests",
                to="tokens.sharetoken",
            ),
        ),
        migrations.CreateModel(
            name="ImportedFormerMember",
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
                ("shares_at_cessation", models.DecimalField(decimal_places=0, max_digits=78)),
                ("ceased_on", models.DateField(db_index=True)),
                (
                    "source_import",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="former_members_rows",
                        to="tokens.registerimport",
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="imported_former_members",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-ceased_on", "name"],
            },
        ),
        migrations.CreateModel(
            name="FormerHolder",
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
                ("wallet_address", models.CharField(db_index=True, max_length=42)),
                ("ceased_on", models.DateField(db_index=True)),
                ("ceased_at_block", models.BigIntegerField()),
                ("shares_at_cessation", models.DecimalField(decimal_places=0, max_digits=78)),
                ("name", models.CharField(blank=True, max_length=255)),
                ("residential_address", models.TextField(blank=True)),
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
                        default="unknown",
                        max_length=20,
                    ),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        help_text="Owner, derived from token.company.owner and held directly so a row-level security policy can read it without joining companies",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="former_holders",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "verbose_name": "Former holder",
                "verbose_name_plural": "Former holders",
                "db_table": "tokens_formerholder",
                "ordering": ["-ceased_on", "wallet_address"],
            },
        ),
        migrations.CreateModel(
            name="ClassRightsRevision",
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
                ("revision", models.PositiveIntegerField()),
                ("summary", models.CharField(blank=True, max_length=20000)),
                ("document_reference", models.CharField(blank=True, max_length=255)),
                ("documents", models.JSONField(blank=True, default=list)),
                ("attributes", models.JSONField(blank=True, default=dict)),
                ("effective_date", models.DateField(blank=True, null=True)),
                ("recorded_by_name", models.CharField(blank=True, max_length=255)),
                ("idempotency_key", models.UUIDField()),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="rights_revisions",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-revision"],
            },
        ),
        migrations.AddField(
            model_name="capitalincreaserequest",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="capital_increase_requests",
                to="tokens.sharetoken",
            ),
        ),
        migrations.CreateModel(
            name="RegisterOutput",
            fields=[],
            options={
                "verbose_name": "register outputs",
                "verbose_name_plural": "register outputs",
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("tokens.sharetoken",),
        ),
        migrations.CreateModel(
            name="SigningChallenge",
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
                    "purpose",
                    models.CharField(
                        choices=[
                            ("order_cancel", "Order cancel"),
                            ("order_create", "Order create"),
                            ("order_modify", "Order modify"),
                        ],
                        db_index=True,
                        max_length=20,
                    ),
                ),
                ("wallet_address", models.CharField(db_index=True, max_length=42)),
                ("chain_id", models.PositiveBigIntegerField()),
                ("verifying_contract", models.CharField(max_length=42)),
                ("payload", models.JSONField()),
                ("digest", models.CharField(max_length=66, unique=True)),
                ("nonce", models.PositiveBigIntegerField()),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("consumed_signature", models.CharField(blank=True, max_length=132)),
                (
                    "action",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="challenges",
                        to="tokens.orderactionsubmission",
                    ),
                ),
                (
                    "submission",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="challenges",
                        to="tokens.ordersubmission",
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        help_text="Owner. Supplied by the service, which holds the authenticated caller's wallet.",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="wallets.wallet",
                    ),
                ),
            ],
            options={
                "db_table": "signing_challenges",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="executed_challenge",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="execution",
                to="tokens.signingchallenge",
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="executed_challenge",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="action_execution",
                to="tokens.signingchallenge",
            ),
        ),
        migrations.CreateModel(
            name="SwapOrder",
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
                ("seller_address", models.CharField(max_length=42)),
                ("buyer_address", models.CharField(max_length=42)),
                (
                    "share_amount",
                    models.PositiveBigIntegerField(help_text="Number of shares to transfer (no decimals)"),
                ),
                (
                    "payment_amount",
                    models.PositiveBigIntegerField(
                        help_text="Payment amount in stablecoin smallest units (e.g., cents for 2 decimals)"
                    ),
                ),
                ("nonce", models.PositiveBigIntegerField(help_text="Unique nonce for replay protection")),
                (
                    "order_hash",
                    models.CharField(
                        help_text="V1 SwapOrder struct hash, excluding the domain", max_length=66, unique=True
                    ),
                ),
                (
                    "settlement_protocol_version",
                    models.PositiveSmallIntegerField(db_default=1, default=1, editable=False),
                ),
                ("settlement_context", models.JSONField(blank=True, editable=False, null=True)),
                ("settlement_digest", models.CharField(blank=True, default="", editable=False, max_length=66)),
                ("seller_signature", models.TextField(blank=True, help_text="EIP-712 signature from seller")),
                ("buyer_signature", models.TextField(blank=True, help_text="EIP-712 signature from buyer")),
                ("seller_eligibility_admitted_at", models.DateTimeField(blank=True, null=True)),
                ("buyer_eligibility_admitted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("created", "Created"),
                            ("seller_signed", "Seller Signed"),
                            ("buyer_signed", "Buyer Signed"),
                            ("ready", "Ready for Execution"),
                            ("executing", "Executing"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                            ("expired", "Expired"),
                        ],
                        default="created",
                        max_length=20,
                    ),
                ),
                ("expires_at", models.DateTimeField()),
                ("expiry_release_eligible", models.BooleanField(default=False, editable=False)),
                (
                    "tx_hash",
                    models.CharField(
                        blank=True, help_text="Transaction hash when executed on-chain (legacy field)", max_length=66
                    ),
                ),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("finalized_receipt", models.JSONField(editable=False, null=True)),
                ("error_message", models.TextField(blank=True)),
                (
                    "buyer_eligibility_decision",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "buyer_wallet",
                    models.ForeignKey(
                        help_text="Buyer, derived from buy_order.wallet and held directly so a row-level security policy can read it",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="wallets.wallet",
                    ),
                ),
                (
                    "payment_asset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="swap_orders", to="assets.asset"
                    ),
                ),
                (
                    "seller_eligibility_decision",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "seller_wallet",
                    models.ForeignKey(
                        help_text="Seller, derived from sell_order.wallet and held directly so a row-level security policy can read it",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="wallets.wallet",
                    ),
                ),
                (
                    "share_token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="swap_orders", to="tokens.sharetoken"
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="swap_orders",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "verbose_name": "Swap Order",
                "verbose_name_plural": "Swap Orders",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="SwapApprovalSubmission",
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
                ("participant", models.CharField(editable=False, max_length=6)),
                ("owner_account_id", models.UUIDField(editable=False)),
                ("wallet_id", models.UUIDField(editable=False)),
                ("actor_id", models.PositiveBigIntegerField(editable=False)),
                ("settlement_digest", models.CharField(editable=False, max_length=66)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("sender_address", models.CharField(editable=False, max_length=42)),
                ("token_address", models.CharField(editable=False, max_length=42)),
                ("spender_address", models.CharField(editable=False, max_length=42)),
                ("nonce", models.PositiveBigIntegerField(editable=False)),
                ("tx_hash", models.CharField(editable=False, max_length=66)),
                ("raw_transaction", models.BinaryField()),
                ("intent", models.JSONField(editable=False)),
                ("last_attempt_at", models.DateTimeField(editable=False, null=True)),
                ("acknowledged_at", models.DateTimeField(editable=False, null=True)),
                ("last_error", models.CharField(blank=True, default="", editable=False, max_length=100)),
                (
                    "outcome",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("confirmed", "Confirmed"),
                            ("reverted", "Reverted"),
                            ("superseded", "Superseded"),
                        ],
                        default="pending",
                        editable=False,
                        max_length=10,
                    ),
                ),
                ("block_number", models.PositiveBigIntegerField(editable=False, null=True)),
                ("block_hash", models.CharField(blank=True, default="", editable=False, max_length=66)),
                ("gas_used", models.PositiveBigIntegerField(editable=False, null=True)),
                ("confirmed_at", models.DateTimeField(editable=False, null=True)),
                (
                    "swap",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="approval_submissions",
                        to="tokens.swaporder",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="initial_swap",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.swaporder",
            ),
        ),
        migrations.CreateModel(
            name="TokenDeployment",
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
                ("token_id", models.UUIDField(editable=False, unique=True)),
                ("company_id", models.UUIDField(editable=False)),
                ("principal_id", models.PositiveBigIntegerField(editable=False, null=True)),
                ("intent", models.JSONField(editable=False)),
                ("contract_address", models.CharField(blank=True, max_length=42)),
                ("attribution_required", models.BooleanField(default=False)),
                ("projected_at", models.DateTimeField(null=True)),
                ("approval_intent", models.JSONField(editable=False, null=True)),
                (
                    "approval_outcome",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("pending", "Pending approval"),
                            ("executing", "Approval in progress"),
                            ("confirmed", "Approval confirmed"),
                            ("observed_approved", "Existing approval observed"),
                            ("not_configured", "Swap unavailable at deployment"),
                            ("failed", "Approval failed"),
                        ],
                        editable=False,
                        max_length=24,
                    ),
                ),
                ("approval_retry_of", models.UUIDField(editable=False, null=True)),
                ("approval_observation", models.JSONField(editable=False, null=True)),
                (
                    "approval_operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="swap_approval",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "approval_transaction",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="swap_approvals",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="token_deployment",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "source_deployment",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="execution",
                        to="tokens.registerdeployment",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="token_deployments",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.CreateModel(
            name="TransferOrder",
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
                ("order_type", models.CharField(choices=[("buy", "Buy"), ("sell", "Sell")], max_length=10)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("open", "Open"),
                            ("partially_filled", "Partially Filled"),
                            ("held", "Held Back"),
                            ("matched", "Matched"),
                            ("pending_signature", "Pending Signature"),
                            ("completed", "Completed"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="open",
                        max_length=20,
                    ),
                ),
                ("wallet_address", models.CharField(max_length=42)),
                ("quantity", models.PositiveBigIntegerField()),
                ("price_per_share", models.DecimalField(decimal_places=2, max_digits=18)),
                (
                    "min_quantity",
                    models.PositiveBigIntegerField(
                        default=0,
                        help_text="Minimum quantity per fill. 0 means exact match only (min_quantity = remaining).",
                    ),
                ),
                (
                    "filled_quantity",
                    models.PositiveBigIntegerField(
                        default=0, help_text="Total quantity already filled across all partial fills."
                    ),
                ),
                (
                    "original_quantity",
                    models.PositiveBigIntegerField(
                        blank=True,
                        help_text="Original quantity at order creation (set on first modification).",
                        null=True,
                    ),
                ),
                (
                    "original_price",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="Original price at order creation (set on first modification).",
                        max_digits=18,
                        null=True,
                    ),
                ),
                (
                    "modification_count",
                    models.PositiveIntegerField(default=0, help_text="Number of times this order has been modified."),
                ),
                (
                    "last_modified_at",
                    models.DateTimeField(blank=True, help_text="Timestamp of the most recent modification.", null=True),
                ),
                (
                    "current_signature",
                    models.TextField(
                        blank=True, help_text="Signature from the most recent modification (or creation if unmodified)."
                    ),
                ),
                ("exchange_order_id", models.CharField(blank=True, max_length=66)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("tx_hash", models.CharField(blank=True, max_length=66)),
                ("error_message", models.TextField(blank=True)),
                (
                    "creation_submission",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.ordersubmission",
                    ),
                ),
                (
                    "eligibility_decision",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "last_modification_action",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tokens.orderactionsubmission",
                    ),
                ),
                (
                    "last_modification_eligibility_decision",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "matched_order",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="matched_by",
                        to="tokens.transferorder",
                    ),
                ),
                (
                    "owner_account",
                    models.ForeignKey(
                        help_text="Immutable tenant snapshot for this order.",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="transfer_orders",
                        to="users.useraccount",
                    ),
                ),
                (
                    "payment_asset",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="transfer_orders",
                        to="assets.asset",
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="transfer_orders",
                        to="tokens.sharetoken",
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        help_text="Verified tenant wallet that owns this order.",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="transfer_orders",
                        to="wallets.wallet",
                    ),
                ),
            ],
            options={
                "verbose_name": "Transfer Order",
                "verbose_name_plural": "Transfer Orders",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="swaporder",
            name="buy_order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="swap_as_buy", to="tokens.transferorder"
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="sell_order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="swap_as_sell", to="tokens.transferorder"
            ),
        ),
        migrations.AddField(
            model_name="signingchallenge",
            name="order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="signing_challenges",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="initial_counter_order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="order",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="submission",
                to="tokens.transferorder",
            ),
        ),
        migrations.CreateModel(
            name="OrderModificationLog",
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
                    "field_name",
                    models.CharField(
                        help_text="Name of the field that was modified (e.g., 'quantity', 'price_per_share').",
                        max_length=50,
                    ),
                ),
                ("old_value", models.CharField(help_text="The value before modification.", max_length=100)),
                ("new_value", models.CharField(help_text="The value after modification.", max_length=100)),
                (
                    "modification_message",
                    models.TextField(
                        blank=True,
                        help_text="The message that was signed, for rows written before modifications were authorized by a challenge.",
                    ),
                ),
                ("signature", models.TextField(help_text="The cryptographic signature authorizing this modification.")),
                (
                    "signer_address",
                    models.CharField(help_text="The wallet address that signed the modification.", max_length=42),
                ),
                (
                    "ip_address",
                    models.GenericIPAddressField(
                        blank=True, help_text="IP address of the request that made this modification.", null=True
                    ),
                ),
                ("user_agent", models.TextField(blank=True, help_text="User agent string from the request.")),
                (
                    "challenge",
                    models.ForeignKey(
                        blank=True,
                        help_text="The signing challenge that authorized this modification, and the message it carried.",
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="modification_logs",
                        to="tokens.signingchallenge",
                    ),
                ),
                (
                    "order",
                    models.ForeignKey(
                        help_text="The order that was modified.",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="modification_logs",
                        to="tokens.transferorder",
                    ),
                ),
            ],
            options={
                "verbose_name": "Order Modification Log",
                "verbose_name_plural": "Order Modification Logs",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="actions", to="tokens.transferorder"
            ),
        ),
        migrations.CreateModel(
            name="NAVUpdate",
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
                    "mode",
                    models.CharField(
                        choices=[("historical", "Historical"), ("local", "Local only"), ("chain", "On-chain")],
                        default="historical",
                        editable=False,
                        max_length=12,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("historical", "Historical outcome"),
                            ("queued", "Queued"),
                            ("executing", "Outcome unresolved"),
                            ("confirmed", "Receipt confirmed"),
                            ("applied", "Applied locally"),
                            ("failed", "Refused or failed"),
                        ],
                        default="historical",
                        editable=False,
                        max_length=12,
                    ),
                ),
                ("intent", models.JSONField(editable=False, null=True)),
                ("event", models.JSONField(editable=False, null=True)),
                ("completed_at", models.DateTimeField(editable=False, null=True)),
                (
                    "old_nav_per_token",
                    models.DecimalField(decimal_places=6, help_text="Previous NAV per token", max_digits=20),
                ),
                (
                    "new_nav_per_token",
                    models.DecimalField(decimal_places=6, help_text="New NAV per token", max_digits=20),
                ),
                (
                    "total_reserve_value",
                    models.DecimalField(
                        decimal_places=6, help_text="Synthetic reference value at time of update", max_digits=20
                    ),
                ),
                (
                    "custodian_report_ref",
                    models.CharField(
                        blank=True,
                        help_text="Optional synthetic scenario reference (legacy field name)",
                        max_length=200,
                    ),
                ),
                ("notes", models.TextField(blank=True, help_text="Additional notes about this NAV update")),
                (
                    "operation",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="nav_update",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        blank=True,
                        help_text="On-chain transaction for this NAV update (if executed on-chain)",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="nav_updates",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        help_text="Staff member who performed this update",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="nav_updates",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "yield_token",
                    models.ForeignKey(
                        help_text="The yield token whose NAV was updated",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="nav_updates",
                        to="tokens.yieldtoken",
                    ),
                ),
            ],
            options={
                "verbose_name": "NAV Update",
                "verbose_name_plural": "NAV Updates",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MintRequest",
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
                ("dispatch_id", models.UUIDField(default=uuid.uuid4, editable=False, null=True)),
                ("execution_intent", models.JSONField(editable=False, null=True)),
                (
                    "recipient_address",
                    models.CharField(help_text="Wallet address to receive the minted tokens", max_length=42),
                ),
                (
                    "recipient_name",
                    models.CharField(help_text="Name of the recipient (for audit purposes)", max_length=200),
                ),
                (
                    "amount",
                    models.BigIntegerField(
                        help_text="Amount to mint in raw units (e.g., 10000 = $100.00 for 2-decimal stablecoin, 1000000 = 1.000000 for 6-decimal yield token)"
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("executing", "Outcome unresolved"),
                            ("executed", "Executed"),
                            ("failed", "Failed"),
                            ("rejected", "Rejected"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                (
                    "deposit_reference",
                    models.CharField(help_text="Synthetic scenario reference or test case ID", max_length=100),
                ),
                ("deposit_date", models.DateField(help_text="Date assigned to the synthetic scenario")),
                (
                    "executed_at",
                    models.DateTimeField(blank=True, help_text="Timestamp when the mint was executed", null=True),
                ),
                ("notes", models.TextField(blank=True, help_text="Additional notes about this mint request")),
                ("rejection_reason", models.TextField(blank=True, help_text="Reason for rejection (if rejected)")),
                ("error_message", models.TextField(blank=True, help_text="Error message if mint failed")),
                (
                    "executed_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="Staff member who executed this request",
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="mint_requests_executed",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "operation",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="mint_request",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "requested_by",
                    models.ForeignKey(
                        help_text="Staff member who created this request",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="mint_requests_created",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "settlement_asset",
                    models.ForeignKey(
                        blank=True,
                        help_text="The settlement asset being minted (if applicable)",
                        limit_choices_to={"asset_type": "stablecoin"},
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="mint_requests",
                        to="assets.asset",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="mint_requests",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
                (
                    "yield_token",
                    models.ForeignKey(
                        blank=True,
                        help_text="The yield token being minted (if applicable)",
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="mint_requests",
                        to="tokens.yieldtoken",
                    ),
                ),
            ],
            options={
                "verbose_name": "Mint Request",
                "verbose_name_plural": "Mint Requests",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MemberAssociationRevocation",
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
                ("idempotency_key", models.UUIDField()),
                ("reason", models.CharField(max_length=1000)),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "association",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="revocation",
                        to="tokens.memberassociation",
                    ),
                ),
                (
                    "revoked_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("revoked_by", "idempotency_key"), name="member_association_revocation_key"
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="MemberCertificateWithdrawal",
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
                ("idempotency_key", models.UUIDField()),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="withdrawal",
                        to="tokens.membercertificaterequest",
                    ),
                ),
                (
                    "withdrawn_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("withdrawn_by", "idempotency_key"), name="member_certificate_withdrawal_key"
                    )
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="memberassociation",
            constraint=models.UniqueConstraint(
                condition=models.Q(("current", True)),
                fields=("company", "member"),
                name="one_current_member_association",
            ),
        ),
        migrations.AddConstraint(
            model_name="memberassociation",
            constraint=models.UniqueConstraint(
                condition=models.Q(("current", True)),
                fields=("company", "user_account"),
                name="one_current_account_association",
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
            model_name="registercapitalincreasedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_capital_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registercapitalincreasedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("capital_increase",),
                name="one_register_capital_outcome",
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
        migrations.AddConstraint(
            model_name="registerdeploymentdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_deployment_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerdeploymentdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_deployment",),
                name="one_register_deployment_outcome",
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
            model_name="registerawardvestingreversal",
            constraint=models.CheckConstraint(
                condition=models.Q(("reversed_shares__gt", 0)), name="register_award_reversal_positive_quantity"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerawardvesting",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_award_vesting_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerawardend",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("unvested_shares__gte", 0),
                    ("vested_shares__gte", 0),
                    models.Q(("unvested_shares__gt", 0), ("vested_shares__gt", 0), _connector="OR"),
                ),
                name="register_award_end_positive_quantity",
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
        migrations.AddConstraint(
            model_name="registerinstructiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_issue_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerinstructiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("instruction",),
                name="one_register_issue_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberwallet",
            constraint=models.UniqueConstraint(fields=("company", "address"), name="register_wallet_company_address"),
        ),
        migrations.AddConstraint(
            model_name="registeropeningdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_opening_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registeropeningdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_opening",),
                name="one_register_opening_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerparticularschangedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_particulars_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerparticularschangedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_particulars_change",),
                name="one_register_particulars_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.UniqueConstraint(
                condition=models.Q(("completed_at__isnull", True)),
                fields=("chain_id", "contract_address"),
                name="one_unresolved_token_pause",
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(condition=models.Q(("chain_id__gt", 0)), name="pause_change_chain"),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("contract_address__regex", "^0x[0-9a-f]{40}$")), name="pause_change_address"
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("authority__in", ["issuer", "staff", "company"])), name="pause_change_authority"
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["pending", "executing", "observed", "confirmed", "failed"])),
                name="pause_change_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerpausechangedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_pause_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerpausechangedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("pause_change",),
                name="one_register_pause_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.UniqueConstraint(
                fields=("reconciliation", "discrepancy"), name="register_acknowledged_once"
            ),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.UniqueConstraint(
                condition=models.Q(("idempotency_key__isnull", False)),
                fields=("acknowledged_by_id", "idempotency_key"),
                name="one_register_acknowledgement_per_key",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    models.Q(
                        ("source_allotment__isnull", False),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", False),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", False),
                        ("source_transfer__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
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
        migrations.AddConstraint(
            model_name="registerwalletlink",
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
                name="register_wallet_link_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlinkdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_wallet_link_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlinkdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_wallet_link",),
                name="one_register_wallet_link_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerposition",
            constraint=models.UniqueConstraint(fields=("register", "member"), name="register_member_position"),
        ),
        migrations.AddConstraint(
            model_name="registerposition",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gte", 0)), name="register_position_nonnegative"
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
            model_name="registerentry",
            constraint=models.UniqueConstraint(fields=("register", "sequence"), name="register_entry_sequence"),
        ),
        migrations.AddConstraint(
            model_name="registerentry",
            constraint=models.UniqueConstraint(fields=("register", "operation_id"), name="register_entry_operation"),
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
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.CheckConstraint(condition=models.Q(("decimals", 0)), name="share_token_whole_units"),
        ),
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.UniqueConstraint(fields=("company", "symbol"), name="unique_company_symbol"),
        ),
        migrations.AddIndex(
            model_name="shareissuancerequest",
            index=models.Index(fields=["token", "status"], name="tokens_shar_token_i_d88bfe_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuancerequest",
            index=models.Index(fields=["status"], name="tokens_shar_status_a2f450_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuance",
            index=models.Index(fields=["token", "status"], name="tokens_shar_token_i_02da62_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuance",
            index=models.Index(fields=["recipient_address"], name="tokens_shar_recipie_43e93e_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuance",
            index=models.Index(fields=["tx_hash"], name="tokens_shar_tx_hash_e61cbd_idx"),
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
            model_name="registeropening",
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
                name="register_opening_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberdocument",
            constraint=models.UniqueConstraint(
                fields=("recorded_by", "idempotency_key"), name="one_member_document_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberdocument",
            constraint=models.UniqueConstraint(
                fields=("member", "token", "evidence"), name="one_member_class_document"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("authority", "company_records"),
                        ("source_confirmed", True),
                        models.Q(("source_reference__regex", "^\\s*$"), _negated=True),
                        models.Q(
                            models.Q(
                                ("base_hash", ""), ("base_sequence__isnull", True), ("correction_of__isnull", True)
                            ),
                            models.Q(
                                ("base_hash__regex", "^[0-9a-f]{64}$"),
                                ("base_sequence__gt", 0),
                                ("correction_of__isnull", False),
                            ),
                            _connector="OR",
                        ),
                    ),
                    models.Q(
                        ("base_hash", ""),
                        ("base_sequence__isnull", True),
                        ("correction_of__isnull", True),
                        ("source_confirmed", False),
                        ("source_reference", ""),
                    ),
                    _connector="OR",
                ),
                name="register_import_mirror_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.UniqueConstraint(
                condition=models.Q(("correction_of__isnull", True), ("status", "applied")),
                fields=("token",),
                name="one_applied_register_import_per_class",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.UniqueConstraint(
                condition=models.Q(("correction_of__isnull", False), ("status", "applied")),
                fields=("correction_of",),
                name="one_applied_mirror_correction_per_snapshot",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("asic_document__isnull", True),
                        ("authority", "company_records"),
                        ("preparing_appointment__isnull", False),
                        ("source_confirmed", True),
                        ("source_document__isnull", True),
                    ),
                    models.Q(
                        ("asic_document__isnull", False),
                        ("asic_evidence__isnull", True),
                        ("asic_file", ""),
                        ("asic_snapshot__isnull", True),
                        ("correction_of__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("register_evidence__isnull", True),
                        ("source_confirmed", False),
                        ("source_document__isnull", False),
                        ("source_reference", ""),
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
        migrations.AddConstraint(
            model_name="registergrant",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_grant_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "inspection_copy"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("late__isnull", False),
                        ("requested_on__isnull", False),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                        models.Q(("recipient__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_inspection_copy_request",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "register_csv"), _negated=True),
                    models.Q(
                        ("digest", ""),
                        ("instruction", ""),
                        ("late__isnull", True),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_export_csv_carries_no_request",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "certificate"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("former_rows", 0),
                        ("late__isnull", True),
                        ("member_rows__gte", 1),
                        ("member_rows__lte", 2),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_certificate_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "notice_figures"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("former_rows", 0),
                        ("late__isnull", True),
                        ("period_from__isnull", False),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_notice_figures_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind", "notice_figures"), ("period_from__isnull", True), _connector="OR"),
                name="register_export_period_only_for_notice_figures",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "company_pack"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("late__isnull", True),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                        models.Q(("recipient__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_company_pack_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="registeraward",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_award_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerallotment",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_allotment_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="importedformermember",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares_at_cessation__gt", 0)), name="imported_former_member_positive_shares"
            ),
        ),
        migrations.AddIndex(
            model_name="formerholder",
            index=models.Index(fields=["token", "-ceased_on"], name="tokens_form_token_i_7339eb_idx"),
        ),
        migrations.AddConstraint(
            model_name="formerholder",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares_at_cessation__gt", 0)), name="former_holder_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="formerholder",
            constraint=models.UniqueConstraint(
                fields=("token", "wallet_address", "ceased_at_block"), name="one_cessation_per_wallet_per_block"
            ),
        ),
        migrations.AddConstraint(
            model_name="classrightsrevision",
            constraint=models.CheckConstraint(
                condition=models.Q(("revision__gt", 0)), name="class_rights_positive_revision"
            ),
        ),
        migrations.AddConstraint(
            model_name="classrightsrevision",
            constraint=models.UniqueConstraint(fields=("token", "revision"), name="one_class_rights_revision"),
        ),
        migrations.AddConstraint(
            model_name="classrightsrevision",
            constraint=models.UniqueConstraint(
                fields=("recorded_by", "idempotency_key"), name="one_class_rights_request"
            ),
        ),
        migrations.AddIndex(
            model_name="capitalincreaserequest",
            index=models.Index(fields=["token", "status"], name="tokens_capi_token_i_e6b6f8_idx"),
        ),
        migrations.AddIndex(
            model_name="capitalincreaserequest",
            index=models.Index(fields=["status"], name="tokens_capi_status_2e7f84_idx"),
        ),
        migrations.AddConstraint(
            model_name="capitalincreaserequest",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status__in", ("submitted", "under_review", "approved", "executing"))),
                fields=("token",),
                name="one_capital_increase_in_flight_per_token",
            ),
        ),
        migrations.AddIndex(
            model_name="swapapprovalsubmission",
            index=models.Index(
                condition=models.Q(("outcome", "pending")),
                fields=["updated_at", "created_at", "uuid"],
                name="pending_swap_approval_recovery",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.UniqueConstraint(
                fields=("chain_id", "tx_hash"), name="unique_swap_approval_submission_hash"
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.UniqueConstraint(
                fields=("chain_id", "sender_address", "nonce"), name="unique_swap_approval_submission_nonce"
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("chain_id__gt", 0)), name="swap_approval_submission_chain_id"
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("participant__in", ("seller", "buyer"))),
                name="swap_approval_submission_participant",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("settlement_digest__regex", "^0x[0-9a-f]{64}$"), ("tx_hash__regex", "^0x[0-9a-f]{64}$")
                ),
                name="swap_approval_submission_hashes",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("sender_address__regex", "^0x[0-9a-f]{40}$"),
                    ("spender_address__regex", "^0x[0-9a-f]{40}$"),
                    ("token_address__regex", "^0x[0-9a-f]{40}$"),
                ),
                name="swap_approval_submission_addresses",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("block_hash__regex", "^0x[0-9a-f]{64}$"),
                        ("block_number__isnull", False),
                        ("confirmed_at__isnull", False),
                        ("gas_used__isnull", False),
                        ("outcome__in", ("confirmed", "reverted")),
                    ),
                    models.Q(
                        ("block_hash", ""),
                        ("block_number__isnull", True),
                        ("confirmed_at__isnull", True),
                        ("gas_used__isnull", True),
                        ("outcome__in", ("pending", "superseded")),
                    ),
                    _connector="OR",
                ),
                name="swap_approval_submission_receipt_present",
            ),
        ),
        migrations.AddIndex(
            model_name="transferorder",
            index=models.Index(fields=["token", "status"], name="tokens_tran_token_i_2d56dc_idx"),
        ),
        migrations.AddIndex(
            model_name="transferorder",
            index=models.Index(fields=["wallet_address"], name="tokens_tran_wallet__ea7fe6_idx"),
        ),
        migrations.AddIndex(
            model_name="transferorder",
            index=models.Index(fields=["order_type", "status"], name="tokens_tran_order_t_944477_idx"),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("creation_submission__isnull", True), ("eligibility_decision__isnull", True)),
                    models.Q(("creation_submission__isnull", False), ("eligibility_decision__isnull", False)),
                    _connector="OR",
                ),
                name="transfer_order_eligibility_birth_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("last_modification_action__isnull", True),
                        ("last_modification_eligibility_decision__isnull", True),
                    ),
                    models.Q(
                        ("last_modification_action__isnull", False),
                        ("last_modification_eligibility_decision__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="transfer_order_modification_eligibility_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("quantity__gt", 0)), name="transfer_order_positive_quantity"
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("price_per_share__gt", 0), ("price_per_share__lt", Decimal("10000000000000000"))),
                name="transfer_order_positive_price",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("filled_quantity__gte", 0), ("filled_quantity__lte", models.F("quantity"))),
                name="transfer_order_filled_bounds",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("min_quantity__gte", 0), ("min_quantity__lte", models.F("quantity"))),
                name="transfer_order_minimum_bounds",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "status__in",
                        ["open", "partially_filled", "held", "matched", "pending_signature", "completed", "cancelled"],
                    )
                ),
                name="transfer_order_known_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("order_type__in", ["buy", "sell"])), name="transfer_order_known_type"
            ),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["status"], name="tokens_swap_status_3b2095_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["seller_address"], name="tokens_swap_seller__d9b2e1_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["buyer_address"], name="tokens_swap_buyer_a_67185b_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["expires_at"], name="tokens_swap_expires_5642fe_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["share_token", "status"], name="tokens_swap_share_t_a18876_idx"),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("seller_eligibility_admitted_at__isnull", True), ("seller_eligibility_decision__isnull", True)
                    ),
                    models.Q(
                        ("seller_eligibility_admitted_at__isnull", False),
                        ("seller_eligibility_decision__isnull", False),
                        models.Q(("seller_signature", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="swap_seller_eligibility_signature_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("buyer_eligibility_admitted_at__isnull", True), ("buyer_eligibility_decision__isnull", True)
                    ),
                    models.Q(
                        ("buyer_eligibility_admitted_at__isnull", False),
                        ("buyer_eligibility_decision__isnull", False),
                        models.Q(("buyer_signature", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="swap_buyer_eligibility_signature_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.UniqueConstraint(fields=("nonce",), name="unique_swap_nonce"),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(("share_amount__gt", 0)), name="swap_order_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(("payment_amount__gt", 0)), name="swap_order_positive_payment"
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "status__in",
                        [
                            "created",
                            "seller_signed",
                            "buyer_signed",
                            "ready",
                            "executing",
                            "completed",
                            "failed",
                            "expired",
                        ],
                    )
                ),
                name="swap_order_known_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("settlement_context__isnull", True),
                        ("settlement_digest", ""),
                        ("settlement_protocol_version", 0),
                    ),
                    models.Q(
                        ("settlement_context__isnull", False),
                        ("settlement_digest__regex", "^0x[0-9a-f]{64}$"),
                        ("settlement_protocol_version", 1),
                    ),
                    _connector="OR",
                ),
                name="swap_order_settlement_context_present",
            ),
        ),
        migrations.AddIndex(
            model_name="signingchallenge",
            index=models.Index(fields=["wallet_address", "purpose"], name="signing_cha_wallet__ff224b_idx"),
        ),
        migrations.AddIndex(
            model_name="signingchallenge",
            index=models.Index(fields=["expires_at"], name="signing_cha_expires_5d4df2_idx"),
        ),
        migrations.AddConstraint(
            model_name="signingchallenge",
            constraint=models.UniqueConstraint(fields=("wallet_address", "nonce"), name="unique_nonce_per_wallet"),
        ),
        migrations.AddConstraint(
            model_name="signingchallenge",
            constraint=models.CheckConstraint(
                condition=models.Q(("submission__isnull", True), ("action__isnull", True), _connector="OR"),
                name="signing_challenge_one_intent",
            ),
        ),
        migrations.AddConstraint(
            model_name="signingchallenge",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("consumed_at__isnull", True), ("consumed_signature", "")),
                    models.Q(("consumed_at__isnull", False), models.Q(("consumed_signature", ""), _negated=True)),
                    _connector="OR",
                ),
                name="signing_challenge_complete_spend",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("status", "created"), ("eligibility_decision__isnull", True), _connector="OR"),
                name="order_submission_eligibility_created_only",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.UniqueConstraint(
                fields=("owner_account", "submission_id"), name="order_submission_account_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("chain_id__gt", 0),
                    ("intent_version", 1),
                    ("quantity__gt", 0),
                    ("min_quantity__gte", 0),
                    ("min_quantity__lte", models.F("quantity")),
                    ("price_per_share__gt", 0),
                    ("price_per_share__lt", Decimal("10000000000000000")),
                    ("order_type__in", ["buy", "sell"]),
                ),
                name="order_submission_valid_terms",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("executed_challenge__isnull", True),
                        ("initial_counter_order__isnull", True),
                        ("initial_swap__isnull", True),
                        ("order__isnull", True),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("resolved_at__isnull", True),
                        ("status", "pending"),
                    ),
                    models.Q(
                        ("executed_challenge__isnull", False),
                        ("order__isnull", False),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("resolved_at__isnull", False),
                        ("status", "created"),
                    ),
                    models.Q(
                        ("executed_challenge__isnull", False),
                        ("initial_counter_order__isnull", True),
                        ("initial_swap__isnull", True),
                        ("order__isnull", True),
                        (
                            "refusal_code__in",
                            [
                                "not_whitelisted",
                                "insufficient_balance",
                                "invalid_settlement_amount",
                                "settlement_chain_disagreement",
                                "investor_not_eligible",
                            ],
                        ),
                        ("resolved_at__isnull", False),
                        ("status", "refused"),
                        models.Q(("refusal_detail", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="order_submission_outcome_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("initial_counter_order__isnull", True), ("initial_swap__isnull", True)),
                    models.Q(("initial_counter_order__isnull", False), ("initial_swap__isnull", False)),
                    _connector="OR",
                ),
                name="order_submission_match_pair",
            ),
        ),
        migrations.AddIndex(
            model_name="ordermodificationlog",
            index=models.Index(fields=["order", "created_at"], name="tokens_orde_order_i_eb9ab0_idx"),
        ),
        migrations.AddIndex(
            model_name="ordermodificationlog",
            index=models.Index(fields=["signer_address"], name="tokens_orde_signer__b71cce_idx"),
        ),
        migrations.AddIndex(
            model_name="ordermodificationlog",
            index=models.Index(fields=["field_name"], name="tokens_orde_field_n_b2e7f3_idx"),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("eligibility_admitted_at__isnull", True), ("eligibility_decision__isnull", True)),
                    models.Q(
                        ("eligibility_admitted_at__isnull", False),
                        ("eligibility_decision__isnull", False),
                        ("purpose", "modify"),
                        ("status", "applied"),
                    ),
                    _connector="OR",
                ),
                name="order_action_eligibility_modify_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.UniqueConstraint(fields=("owner_account", "action_id"), name="order_action_account_key"),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("chain_id__gt", 0),
                    ("protocol_version", 1),
                    models.Q(
                        models.Q(
                            ("new_min_quantity__isnull", True),
                            ("new_price_per_share__isnull", True),
                            ("new_quantity__isnull", True),
                            ("purpose", "cancel"),
                        ),
                        models.Q(
                            ("new_min_quantity__gte", 0),
                            ("new_min_quantity__isnull", False),
                            ("new_price_per_share__gt", 0),
                            ("new_price_per_share__isnull", False),
                            ("new_price_per_share__lt", Decimal("10000000000000000")),
                            ("new_quantity__gt", 0),
                            ("new_quantity__isnull", False),
                            ("purpose", "modify"),
                        ),
                        _connector="OR",
                    ),
                ),
                name="order_action_valid_intent",
            ),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("executed_by__isnull", True),
                        ("executed_challenge__isnull", True),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("refusal_status__isnull", True),
                        ("resolved_at__isnull", True),
                        ("result__isnull", True),
                        ("status", "pending"),
                    ),
                    models.Q(
                        ("executed_by__isnull", False),
                        ("executed_challenge__isnull", False),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("refusal_status__isnull", True),
                        ("resolved_at__isnull", False),
                        ("result__isnull", False),
                        ("status", "applied"),
                    ),
                    models.Q(
                        ("executed_by__isnull", False),
                        ("executed_challenge__isnull", False),
                        ("refusal_status__isnull", False),
                        ("resolved_at__isnull", False),
                        ("result__isnull", True),
                        ("status", "refused"),
                        models.Q(("refusal_detail", ""), _negated=True),
                        models.Q(
                            models.Q(
                                ("purpose", "cancel"),
                                ("refusal_code", "order_cancellation_failed"),
                                ("refusal_status", 400),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "order_modification_failed"),
                                ("refusal_status", 400),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "order_modification_conflict"),
                                ("refusal_status", 409),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "investor_not_eligible"),
                                ("refusal_status", 403),
                            ),
                            _connector="OR",
                        ),
                    ),
                    _connector="OR",
                ),
                name="order_action_outcome_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="navupdate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("completed_at__isnull", True), ("mode__in", ["local", "chain"])),
                fields=("yield_token",),
                name="one_unresolved_nav_per_token",
            ),
        ),
        migrations.AddConstraint(
            model_name="navupdate",
            constraint=models.UniqueConstraint(
                models.F("intent__contract_address"),
                condition=models.Q(("completed_at__isnull", True), ("mode", "chain")),
                name="one_unresolved_nav_per_contract",
            ),
        ),
        migrations.AddIndex(
            model_name="mintrequest",
            index=models.Index(fields=["status"], name="tokens_mint_status_99ebab_idx"),
        ),
        migrations.AddIndex(
            model_name="mintrequest",
            index=models.Index(fields=["deposit_reference"], name="tokens_mint_deposit_d00e57_idx"),
        ),
        migrations.AddIndex(
            model_name="mintrequest",
            index=models.Index(fields=["recipient_address"], name="tokens_mint_recipie_c3a7c5_idx"),
        ),
    ]
