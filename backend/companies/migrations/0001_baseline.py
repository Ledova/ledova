import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

import companies.models.authority_request
import companies.models.document
import companies.validators
import shared.storage


class Migration(migrations.Migration):

    replaces = [
        ("companies", "0001_initial"),
        ("companies", "0002_company_owner_required"),
        ("companies", "0003_delete_review_and_signature_models"),
        ("companies", "0004_company_additional_info_response"),
        ("companies", "0005_company_is_open_to_investors"),
        ("companies", "0006_company_document_private_storage"),
        ("companies", "0007_alter_company_abn_alter_company_acn"),
        ("companies", "0008_company_registry_verification"),
        ("companies", "0009_document_verification"),
        ("companies", "0010_company_pack"),
        ("companies", "0011_remove_company_api_key"),
        ("companies", "0012_company_authority_request"),
        ("companies", "0013_company_authority_request_withdrawal"),
        ("companies", "0014_authority_request_capabilities_refuse_null"),
        ("companies", "0015_self_declared_company_appointments"),
        ("companies", "0016_appointee_keyed_appointments"),
        ("companies", "0017_company_team_invitations"),
        ("companies", "0018_team_invitation_admission_guards"),
        ("companies", "0019_legacy_owner_appointments"),
        ("companies", "0020_company_administration"),
        ("companies", "0021_company_activation"),
    ]

    initial = True

    dependencies = [
        ("authentication", "__first__"),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyAppointment",
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
                ("capabilities", models.JSONField(editable=False)),
                ("delegatable_capabilities", models.JSONField(editable=False)),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("declaration_version", models.CharField(editable=False, max_length=10, null=True)),
                ("declaration_text", models.TextField(editable=False, null=True)),
            ],
        ),
        migrations.CreateModel(
            name="CompanyAppointmentRevocation",
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
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="CompanyAuthorityRequest",
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
                ("purpose", models.CharField(default="bootstrap", editable=False, max_length=16)),
                ("company_identity_raw", models.JSONField(editable=False)),
                ("company_identity", models.JSONField(editable=False)),
                ("person_identity_raw", models.JSONField(editable=False)),
                ("person_identity", models.JSONField(editable=False)),
                ("requested_capabilities", models.JSONField(editable=False)),
                ("delegatable_capabilities", models.JSONField(editable=False)),
                ("requested_expires_at", models.DateTimeField(editable=False, null=True)),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=companies.models.authority_request.authority_evidence_path,
                    ),
                ),
                ("original_filename", models.CharField(editable=False, max_length=255)),
                ("file_size", models.PositiveIntegerField(editable=False)),
                ("mime_type", models.CharField(editable=False, max_length=100)),
                ("file_sha256", models.CharField(editable=False, max_length=64)),
                ("request_digest", models.CharField(editable=False, max_length=64)),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="CompanyAuthorityRequestWithdrawal",
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
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="CompanyDocument",
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
                    "document_type",
                    models.CharField(
                        choices=[
                            ("cert_inc", "Certificate of Incorporation"),
                            ("asic", "ASIC Company Extract"),
                            ("constitution", "Company Constitution"),
                            ("share_register", "Current Share Register"),
                            ("financials", "Financial Statements"),
                            ("auditor_report", "Auditor Report"),
                            ("director_id", "Director Identification"),
                            ("beneficial_ownership", "Beneficial Ownership Declaration"),
                            ("shareholder", "Shareholder Agreement"),
                            ("business_plan", "Business Plan"),
                            ("risk_disclosure", "Risk Disclosure Statement"),
                            ("prospectus", "Prospectus or Information Memorandum"),
                            ("legal_opinion", "Legal Opinion"),
                            ("tax_return", "Tax Return"),
                            ("bank_statement", "Bank Statement"),
                            ("other", "Other"),
                        ],
                        max_length=30,
                    ),
                ),
                ("name", models.CharField(max_length=255)),
                (
                    "file",
                    models.FileField(
                        blank=True,
                        help_text="Uploaded file (preferred)",
                        max_length=255,
                        null=True,
                        storage=shared.storage.private_storage,
                        upload_to=companies.models.document.company_document_path,
                    ),
                ),
                ("external_url", models.URLField(blank=True, help_text="External URL if file is stored elsewhere")),
                ("file_size", models.PositiveIntegerField()),
                ("mime_type", models.CharField(max_length=100)),
                ("valid_from", models.DateField(blank=True, null=True)),
                ("valid_until", models.DateField(blank=True, null=True)),
                ("is_verified", models.BooleanField(default=False)),
                ("verified_fingerprint", models.CharField(blank=True, editable=False, max_length=64)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("rejection_reason", models.TextField(blank=True)),
            ],
            options={
                "verbose_name": "Company Document",
                "verbose_name_plural": "Company Documents",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="CompanyLegacyOwnerSource",
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
                ("provenance", models.CharField(editable=False, max_length=64)),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="CompanyRegistryCheck",
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
                            ("authority", "Representative authority"),
                            ("review", "Start review"),
                            ("retry", "Retry"),
                            ("activation", "Activation"),
                        ],
                        max_length=16,
                    ),
                ),
                ("started_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("completed_at", models.DateTimeField(null=True)),
                ("requested_name", models.CharField(max_length=255)),
                ("requested_acn", models.CharField(max_length=11)),
                ("requested_abn", models.CharField(blank=True, max_length=14)),
                ("identity", models.JSONField()),
                ("lifecycle_revision", models.PositiveBigIntegerField()),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("passed", "Passed"), ("failed", "Failed")],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("reason", models.CharField(blank=True, max_length=40)),
                ("registry_abn", models.CharField(blank=True, max_length=14)),
                ("registry_acn", models.CharField(blank=True, max_length=11)),
                ("entity_name", models.CharField(blank=True, max_length=255)),
                ("entity_type", models.CharField(blank=True, max_length=16)),
                ("entity_status", models.CharField(blank=True, max_length=32)),
                ("effective_from", models.DateField(null=True)),
                ("retrieved_at", models.CharField(blank=True, max_length=40)),
                ("register_updated_at", models.DateField(null=True)),
                ("idempotency_key", models.UUIDField(editable=False, null=True)),
                ("person_identity", models.JSONField(editable=False, null=True)),
                ("issuer_identity_required", models.BooleanField(editable=False, null=True)),
                ("declaration_version", models.CharField(editable=False, max_length=10, null=True)),
                ("declaration_text", models.TextField(editable=False, null=True)),
                ("applied_at", models.DateTimeField(editable=False, null=True)),
            ],
            options={
                "ordering": ["-started_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="CompanyTeamInvitation",
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
                ("idempotency_key", models.UUIDField()),
                ("capabilities", models.JSONField(editable=False)),
                ("delegatable_capabilities", models.JSONField(editable=False)),
                ("acceptance_deadline", models.DateTimeField(editable=False)),
                ("appointment_expires_at", models.DateTimeField(editable=False, null=True)),
                ("code_sha256", models.CharField(editable=False, max_length=64, unique=True)),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="Company",
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
                ("trading_name", models.CharField(blank=True, max_length=255)),
                (
                    "company_type",
                    models.CharField(
                        choices=[
                            ("pty", "Proprietary Limited (Pty Ltd)"),
                            ("public", "Public Company (Ltd)"),
                            ("unlisted", "Unlisted Public Company"),
                        ],
                        default="pty",
                        max_length=20,
                    ),
                ),
                ("acn", models.CharField(max_length=11, unique=True, validators=[companies.validators.validate_acn])),
                ("abn", models.CharField(blank=True, max_length=14, validators=[companies.validators.validate_abn])),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted for Review"),
                            ("review", "Under Review"),
                            ("info_required", "Additional Information Required"),
                            ("approved", "Approved"),
                            ("active", "Active"),
                            ("warning", "Compliance Warning"),
                            ("suspended", "Suspended"),
                            ("delisted", "Delisted"),
                            ("rejected", "Rejected"),
                            ("withdrawn", "Withdrawn"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                ("lifecycle_revision", models.PositiveBigIntegerField(default=0, editable=False)),
                (
                    "registry_status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("passed", "Passed"), ("failed", "Failed")],
                        default="pending",
                        editable=False,
                        max_length=16,
                    ),
                ),
                ("registry_reason", models.CharField(blank=True, editable=False, max_length=40)),
                ("registry_checked_at", models.DateTimeField(blank=True, editable=False, null=True)),
                ("registry_entity_name", models.CharField(blank=True, editable=False, max_length=255)),
                ("registry_entity_status", models.CharField(blank=True, editable=False, max_length=32)),
                ("registry_identity", models.JSONField(blank=True, default=dict, editable=False)),
                ("registry_revision", models.PositiveBigIntegerField(editable=False, null=True)),
                ("registry_purpose", models.CharField(blank=True, editable=False, max_length=16)),
                ("declarant_name", models.CharField(blank=True, max_length=255)),
                ("board_resolution_reference", models.CharField(blank=True, max_length=255)),
                ("officeholder_attested_at", models.DateTimeField(blank=True, editable=False, null=True)),
                ("officeholder_attestation", models.JSONField(blank=True, default=dict, editable=False)),
                ("phone", models.CharField(blank=True, max_length=20)),
                ("address_line_1", models.CharField(blank=True, max_length=255)),
                ("address_line_2", models.CharField(blank=True, max_length=255)),
                ("city", models.CharField(blank=True, max_length=100)),
                ("state", models.CharField(blank=True, max_length=50)),
                ("postcode", models.CharField(blank=True, max_length=10)),
                ("country", models.CharField(blank=True, default="Australia", max_length=50)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("review_started_at", models.DateTimeField(blank=True, null=True)),
                ("review_completed_at", models.DateTimeField(blank=True, null=True)),
                ("approved_at", models.DateTimeField(blank=True, null=True)),
                ("info_requested_at", models.DateTimeField(blank=True, null=True)),
                ("info_request_reason", models.TextField(blank=True)),
                ("additional_info_response", models.TextField(blank=True)),
                ("rejection_reason", models.TextField(blank=True)),
                ("rejection_at", models.DateTimeField(blank=True, null=True)),
                ("warning_issued_at", models.DateTimeField(blank=True, null=True)),
                ("warning_reason", models.TextField(blank=True)),
                ("suspended_at", models.DateTimeField(blank=True, null=True)),
                ("suspension_reason", models.TextField(blank=True)),
                ("delisted_at", models.DateTimeField(blank=True, null=True)),
                ("delisting_reason", models.TextField(blank=True)),
                ("withdrawn_at", models.DateTimeField(blank=True, null=True)),
                ("withdrawal_reason", models.TextField(blank=True)),
                ("activated_at", models.DateTimeField(blank=True, null=True)),
                ("description", models.TextField(blank=True)),
                ("industry", models.CharField(blank=True, max_length=100)),
                ("founded_year", models.PositiveIntegerField(blank=True, null=True)),
                (
                    "is_open_to_investors",
                    models.BooleanField(
                        default=False, help_text="Show this company's share classes in the investor directory."
                    ),
                ),
                (
                    "approved_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="approved_companies",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "officeholder_attested_by",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Company",
                "verbose_name_plural": "Companies",
                "ordering": ["-created_at"],
            },
        ),
    ]
