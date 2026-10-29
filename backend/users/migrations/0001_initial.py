import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import users.models.investor_classification


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("companies", "0001_initial"),
        ("shared", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserAccount",
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
                ("account_number", models.CharField(default="individual", max_length=20)),
                (
                    "account_type",
                    models.CharField(choices=[("individual", "Individual")], default="individual", max_length=20),
                ),
                (
                    "account_status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending Verification"),
                            ("active", "Active"),
                            ("rejected", "Rejected"),
                            ("suspended", "Suspended"),
                            ("terminated", "Terminated"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                (
                    "role",
                    models.CharField(
                        choices=[("investor", "Investor"), ("company", "Company"), ("both", "Both")],
                        default="investor",
                        max_length=10,
                    ),
                ),
                ("activation_date", models.DateTimeField(blank=True, null=True)),
                ("rejection_reason", models.CharField(blank=True, max_length=100)),
            ],
            options={
                "verbose_name": "User Account",
                "verbose_name_plural": "User Accounts",
                "db_table": "customer_accounts_account",
            },
        ),
        migrations.CreateModel(
            name="CompanyEligibilityRequest",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("version", models.CharField(default="1", editable=False, max_length=10)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("accountant_certificate", "Qualified accountant's certificate (s708(8)(c))"),
                            ("professional_investor", "Professional investor (s708(11) / s761G(7)(d))"),
                        ],
                        editable=False,
                        max_length=30,
                    ),
                ),
                ("shared_summary", models.JSONField(editable=False)),
                ("source_fingerprint", models.CharField(editable=False, max_length=64)),
                ("evidence_hash", models.CharField(editable=False, max_length=64)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("requested_expires_at", models.DateTimeField(editable=False)),
                ("submitted_at", models.DateTimeField(editable=False)),
                ("sharing_accepted", models.BooleanField(editable=False)),
                ("declaration_accepted", models.BooleanField(editable=False)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="eligibility_requests",
                        to="companies.company",
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
                "ordering": ["-submitted_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="CompanyEligibilityDecision",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("request_digest", models.CharField(editable=False, max_length=64)),
                ("digest", models.CharField(editable=False, max_length=64)),
                (
                    "outcome",
                    models.CharField(
                        choices=[("accepted", "Accepted by the company"), ("refused", "Refused by the company")],
                        editable=False,
                        max_length=12,
                    ),
                ),
                ("decided_at", models.DateTimeField(editable=False)),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("reason", models.CharField(blank=True, editable=False, max_length=500)),
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
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decision",
                        to="users.companyeligibilityrequest",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="CompanyEligibilityRequestWithdrawal",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("withdrawn_at", models.DateTimeField(editable=False)),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="withdrawal",
                        to="users.companyeligibilityrequest",
                    ),
                ),
                (
                    "withdrawn_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="CompanyEligibilityRevocation",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("reason", models.CharField(editable=False, max_length=500)),
                ("revoked_at", models.DateTimeField(editable=False)),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decision",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="revocation",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "revoked_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="DeviceToken",
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
                    "push_token",
                    models.CharField(
                        help_text="Expo push token (e.g., ExponentPushToken[xxx])", max_length=255, unique=True
                    ),
                ),
                (
                    "device_type",
                    models.CharField(
                        choices=[("ios", "iOS"), ("android", "Android")],
                        help_text="Device platform (iOS or Android)",
                        max_length=10,
                    ),
                ),
                (
                    "is_active",
                    models.BooleanField(
                        default=True, help_text="Whether this token is active and can receive notifications"
                    ),
                ),
                (
                    "last_used_at",
                    models.DateTimeField(
                        auto_now=True, help_text="Last time this token was used to send a notification"
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        help_text="User who owns this device",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="device_tokens",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Device Token",
                "verbose_name_plural": "Device Tokens",
                "db_table": "users_device_token",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="InvestorClassification",
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
                            ("accountant_certificate", "Qualified accountant's certificate (s708(8)(c))"),
                            ("professional_investor", "Professional investor (s708(11) / s761G(7)(d))"),
                        ],
                        max_length=30,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("submitted", "Submitted"),
                            ("verified", "Verified"),
                            ("rejected", "Rejected"),
                            ("revoked", "Revoked"),
                            ("withdrawn", "Withdrawn"),
                        ],
                        default="submitted",
                        max_length=20,
                    ),
                ),
                ("declaration_accepted", models.BooleanField(default=False)),
                ("declaration_text", models.TextField(blank=True)),
                ("declared_basis", models.TextField(blank=True)),
                (
                    "evidence_file",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        null=True,
                        storage=shared.storage.private_storage,
                        upload_to=users.models.investor_classification.investor_evidence_path,
                    ),
                ),
                ("evidence_file_size", models.PositiveIntegerField(blank=True, null=True)),
                ("evidence_mime_type", models.CharField(blank=True, max_length=100)),
                ("certificate_issued_at", models.DateField(blank=True, null=True)),
                ("certifier_name", models.CharField(blank=True, max_length=255)),
                (
                    "certifier_body",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("ca_anz", "Chartered Accountants Australia and New Zealand"),
                            ("cpa_australia", "CPA Australia"),
                            ("ipa", "Institute of Public Accountants"),
                        ],
                        max_length=20,
                    ),
                ),
                ("certifier_membership_number", models.CharField(blank=True, max_length=50)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("review_notes", models.TextField(blank=True)),
                ("rejection_reason", models.TextField(blank=True)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        help_text="Staff member who reviewed the claim",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="reviewed_investor_classifications",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "withdrawn_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="investor_classifications",
                        to="users.useraccount",
                    ),
                ),
            ],
            options={
                "verbose_name": "Investor Classification",
                "verbose_name_plural": "Investor Classifications",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="companyeligibilityrequest",
            name="source",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_requests",
                to="users.investorclassification",
            ),
        ),
        migrations.CreateModel(
            name="Notification",
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
                ("title", models.CharField(help_text="Notification title", max_length=255)),
                ("body", models.TextField(help_text="Notification body text")),
                (
                    "notification_type",
                    models.CharField(
                        choices=[("transaction", "Transaction"), ("general", "General"), ("system", "System")],
                        default="general",
                        help_text="Category of the notification",
                        max_length=20,
                    ),
                ),
                (
                    "data",
                    models.JSONField(
                        blank=True, default=dict, help_text="Additional structured data for the notification"
                    ),
                ),
                ("is_read", models.BooleanField(default=False, help_text="Whether the notification has been read")),
                ("read_at", models.DateTimeField(blank=True, help_text="When the notification was read", null=True)),
                (
                    "is_archived",
                    models.BooleanField(default=False, help_text="Whether the notification has been archived"),
                ),
                (
                    "user",
                    models.ForeignKey(
                        help_text="The user this notification belongs to",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notifications",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Notification",
                "verbose_name_plural": "Notifications",
                "db_table": "notifications",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="companyeligibilityrequest",
            name="user_account",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="eligibility_requests", to="users.useraccount"
            ),
        ),
        migrations.CreateModel(
            name="UserProfile",
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
                ("full_name", models.CharField(blank=True, max_length=100, null=True)),
                ("phone_country_code", models.CharField(blank=True, max_length=5, null=True)),
                ("phone_number", models.CharField(blank=True, max_length=15, null=True)),
                ("date_of_birth", models.DateField(blank=True, null=True)),
                ("residential_address", models.TextField(blank=True, null=True)),
                ("id_document_type", models.CharField(blank=True, max_length=50, null=True)),
                ("id_document_country", models.CharField(blank=True, max_length=3, null=True)),
                ("confirmed_over_18", models.BooleanField(default=False)),
                ("confirmed_australian_resident", models.BooleanField(default=False)),
                ("confirmed_individual_account", models.BooleanField(default=False)),
                ("is_id_verified", models.BooleanField(default=False)),
                ("terms_and_conditions", models.BooleanField(default=False)),
                ("is_signup_completed", models.BooleanField(default=False)),
                (
                    "kyc_provider",
                    models.CharField(
                        choices=[("sumsub", "Sumsub"), ("kycaid", "KYCAID")], default="kycaid", max_length=20
                    ),
                ),
                (
                    "verification_status",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("init", "Initialized"),
                            ("pending", "Pending Review"),
                            ("queued", "Queued for Review"),
                            ("completed", "Review Completed"),
                            ("onHold", "On Hold"),
                            ("prechecked", "Pre-checked"),
                        ],
                        max_length=50,
                        null=True,
                    ),
                ),
                (
                    "review_result",
                    models.CharField(
                        blank=True,
                        choices=[("GREEN", "Approved"), ("RED", "Rejected"), ("YELLOW", "Retry")],
                        max_length=20,
                        null=True,
                    ),
                ),
                ("rejection_labels", models.JSONField(blank=True, null=True)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("kycaid_applicant_id", models.CharField(blank=True, max_length=100, null=True)),
                ("sumsub_applicant_id", models.CharField(blank=True, max_length=100, null=True)),
                (
                    "sumsub_verification_status",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("init", "Initialized"),
                            ("pending", "Pending Review"),
                            ("queued", "Queued for Review"),
                            ("completed", "Review Completed"),
                            ("onHold", "On Hold"),
                            ("prechecked", "Pre-checked"),
                        ],
                        max_length=50,
                        null=True,
                    ),
                ),
                (
                    "citizenship_country",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="citizens",
                        to="shared.country",
                    ),
                ),
                (
                    "residence_country",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="residents",
                        to="shared.country",
                    ),
                ),
                (
                    "user",
                    models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="UserPreferences",
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
                    "transaction_alerts",
                    models.BooleanField(default=True, help_text="Notifications for transaction status changes"),
                ),
                (
                    "user_profile",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE, related_name="preferences", to="users.userprofile"
                    ),
                ),
            ],
            options={
                "verbose_name_plural": "User Preferences",
            },
        ),
        migrations.AddField(
            model_name="useraccount",
            name="user_profile",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE, related_name="user_account", to="users.userprofile"
            ),
        ),
        migrations.CreateModel(
            name="FinancialProfile",
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
                    "occupation",
                    models.CharField(
                        blank=True,
                        help_text="Customer's occupation for AML/CTF risk profiling",
                        max_length=200,
                        null=True,
                    ),
                ),
                (
                    "source_of_funds",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text="Primary source of funds: employment_income, savings, investment_income, sale_of_assets, inheritance, gift, other",
                        null=True,
                    ),
                ),
                (
                    "source_of_funds_other_text",
                    models.CharField(
                        blank=True,
                        help_text="Specification when 'other' is selected as source of funds",
                        max_length=200,
                        null=True,
                    ),
                ),
                (
                    "intended_use",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("long_term_investment", "Long-term investment"),
                            ("trading_crypto", "Trading crypto currencies"),
                            ("savings", "Savings"),
                            ("other", "Other"),
                        ],
                        help_text="Customer's intended use of the platform",
                        max_length=50,
                        null=True,
                    ),
                ),
                (
                    "intended_use_other_text",
                    models.CharField(
                        blank=True,
                        help_text="Specification when 'other' is selected as intended use",
                        max_length=200,
                        null=True,
                    ),
                ),
                (
                    "user_profile",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="financial_profile",
                        to="users.userprofile",
                    ),
                ),
            ],
            options={
                "verbose_name_plural": "Financial Profiles",
            },
        ),
        migrations.AddConstraint(
            model_name="companyeligibilitydecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="users_eligibility_decision_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilitydecision",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("expires_at__gt", models.F("decided_at")),
                        ("expires_at__isnull", False),
                        ("outcome", "accepted"),
                        ("reason", ""),
                    ),
                    models.Q(
                        ("expires_at__isnull", True), ("outcome", "refused"), models.Q(("reason", ""), _negated=True)
                    ),
                    _connector="OR",
                ),
                name="users_eligibility_decision_exact_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequestwithdrawal",
            constraint=models.UniqueConstraint(
                fields=("withdrawn_by", "idempotency_key"), name="users_eligibility_withdrawal_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrevocation",
            constraint=models.UniqueConstraint(
                fields=("revoked_by", "idempotency_key"), name="users_eligibility_revocation_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrevocation",
            constraint=models.CheckConstraint(
                condition=models.Q(("reason", ""), _negated=True), name="users_eligibility_revocation_reason"
            ),
        ),
        migrations.AddIndex(
            model_name="devicetoken",
            index=models.Index(fields=["user", "is_active"], name="users_devic_user_id_aed98d_idx"),
        ),
        migrations.AddIndex(
            model_name="devicetoken",
            index=models.Index(fields=["push_token"], name="users_devic_push_to_8d60f9_idx"),
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["user", "-created_at"], name="idx_notification_user_created"),
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["user", "is_read"], name="idx_notification_user_read"),
        ),
        migrations.AddIndex(
            model_name="investorclassification",
            index=models.Index(fields=["user_account", "status"], name="users_inves_user_ac_5d17c5_idx"),
        ),
        migrations.AddIndex(
            model_name="investorclassification",
            index=models.Index(fields=["status"], name="users_inves_status_b9facf_idx"),
        ),
        migrations.AddIndex(
            model_name="companyeligibilityrequest",
            index=models.Index(fields=["company", "submitted_at"], name="users_compa_company_b2e28c_idx"),
        ),
        migrations.AddIndex(
            model_name="companyeligibilityrequest",
            index=models.Index(fields=["user_account", "submitted_at"], name="users_compa_user_ac_70f7e2_idx"),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.UniqueConstraint(
                fields=("submitted_by", "idempotency_key"), name="users_eligibility_request_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.CheckConstraint(
                condition=models.Q(("declaration_accepted", True), ("sharing_accepted", True)),
                name="users_eligibility_request_confirmations",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.CheckConstraint(
                condition=models.Q(("requested_expires_at__gt", models.F("submitted_at"))),
                name="users_eligibility_request_future_expiry",
            ),
        ),
    ]
