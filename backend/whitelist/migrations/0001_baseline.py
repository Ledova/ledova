import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("whitelist", "0001_initial"),
        ("whitelist", "0002_whitelistentry_treasury_addresses"),
        ("whitelist", "0003_whitelistentry_unique_treasury_address"),
        ("whitelist", "0004_failure_reconciled_at"),
        ("whitelist", "0005_whitelist_change"),
        ("whitelist", "0006_whitelist_change_guards"),
        ("whitelist", "0007_per_company_approvals"),
        ("whitelist", "0008_classification_refresh_authority"),
        ("whitelist", "0009_company_eligibility_invalidation"),
        ("whitelist", "0010_company_wallet_instructions"),
        ("whitelist", "0011_company_wallet_instruction_guards"),
    ]

    initial = True

    dependencies = [
        ("authentication", "__first__"),
        ("blockchain", "0001_baseline"),
        ("companies", "0001_baseline"),
        ("users", "0001_baseline"),
        ("wallets", "0001_baseline"),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyWalletInstruction",
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
                    "action",
                    models.CharField(choices=[("add", "Add"), ("remove", "Remove")], editable=False, max_length=6),
                ),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("snapshot", models.JSONField(editable=False)),
                ("intent", models.JSONField(editable=False)),
                ("intent_digest", models.CharField(editable=False, max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("change_id", models.UUIDField(editable=False, null=True, unique=True)),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="wallet_instructions",
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
            name="CompanyWalletInstructionDecision",
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
                        to="whitelist.companywalletinstruction",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletinstructiondecision",
            ),
        ),
        migrations.CreateModel(
            name="CompanyWalletNomination",
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
                ("wallet_id", models.UUIDField(editable=False)),
                ("snapshot", models.JSONField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("preview_digest", models.CharField(editable=False, max_length=64)),
                ("sharing_accepted", models.BooleanField(editable=False)),
                ("submitted_at", models.DateTimeField(editable=False)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="wallet_nominations",
                        to="companies.company",
                    ),
                ),
                (
                    "decision",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="wallet_nominations",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "proof",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="wallets.walletpossessionproof",
                    ),
                ),
                (
                    "request",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="wallet_nominations",
                        to="users.companyeligibilityrequest",
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
        migrations.AddField(
            model_name="companywalletinstruction",
            name="nomination",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletnomination",
            ),
        ),
        migrations.CreateModel(
            name="WhitelistChange",
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
                    "action",
                    models.CharField(choices=[("add", "Add"), ("remove", "Remove")], editable=False, max_length=6),
                ),
                ("address", models.CharField(editable=False, max_length=42)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("registry_address", models.CharField(editable=False, max_length=42)),
                ("company_id", models.UUIDField(editable=False)),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("intent", models.JSONField(editable=False)),
                (
                    "authority",
                    models.CharField(
                        choices=[
                            ("operator_api", "Operator API"),
                            ("whitelist_admin", "Whitelist administration"),
                            ("subscription_admin", "Subscription administration"),
                            ("refresh", "Eligibility invalidation"),
                            ("company", "Company instruction"),
                        ],
                        editable=False,
                        max_length=20,
                    ),
                ),
                (
                    "invalidation_cause",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("source_withdrawal", "Source withdrawn by its holder"),
                            ("request_withdrawal", "Company request withdrawn by its holder"),
                            ("company_revocation", "Company decision revoked"),
                            ("expiry", "Eligibility expired automatically"),
                            ("evidence_purge", "Evidence purged automatically"),
                            ("standing_loss", "Account standing lost"),
                            ("identity_loss", "Configured identity lost"),
                            ("wallet_removal", "Wallet removed or verification lost"),
                        ],
                        editable=False,
                        max_length=32,
                    ),
                ),
                ("invalidated_at", models.DateTimeField(editable=False, null=True)),
                ("requested_wallet_id", models.UUIDField(editable=False, null=True)),
                ("entry_id", models.UUIDField(editable=False, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Checking the admitted change"),
                            ("executing", "Outcome unresolved"),
                            ("confirmed", "Confirmed"),
                            ("unchanged", "No change required"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=10,
                    ),
                ),
                ("failure_code", models.CharField(blank=True, editable=False, max_length=64)),
                ("completed_at", models.DateTimeField(editable=False, null=True)),
                (
                    "eligibility_decision",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "initiated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="whitelist_change",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "source_instruction",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="whitelist.companywalletinstruction",
                    ),
                ),
                (
                    "transaction",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="whitelist_change",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="target_change",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="whitelist.whitelistchange"
            ),
        ),
        migrations.CreateModel(
            name="WhitelistEligibilityInvalidation",
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
                    "cause",
                    models.CharField(
                        choices=[
                            ("source_withdrawal", "Source withdrawn by its holder"),
                            ("request_withdrawal", "Company request withdrawn by its holder"),
                            ("company_revocation", "Company decision revoked"),
                            ("expiry", "Eligibility expired automatically"),
                            ("evidence_purge", "Evidence purged automatically"),
                            ("standing_loss", "Account standing lost"),
                            ("identity_loss", "Configured identity lost"),
                            ("wallet_removal", "Wallet removed or verification lost"),
                        ],
                        editable=False,
                        max_length=32,
                    ),
                ),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("wallet_id", models.UUIDField(editable=False, null=True)),
                ("address", models.CharField(blank=True, editable=False, max_length=42)),
                ("facts", models.JSONField(editable=False)),
                ("cause_fields", models.JSONField(default=list, editable=False)),
                ("invalidated_at", models.DateTimeField(editable=False)),
                (
                    "initiated_by",
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
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="whitelistchange",
            name="eligibility_invalidation",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.whitelisteligibilityinvalidation",
            ),
        ),
        migrations.CreateModel(
            name="WhitelistEntry",
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
                    "address",
                    models.CharField(blank=True, help_text="Set only when the entry has no wallet.", max_length=42),
                ),
                (
                    "label",
                    models.CharField(
                        blank=True, help_text="Treasury or custodian name for a non-user address.", max_length=100
                    ),
                ),
                ("notes", models.TextField(blank=True)),
                (
                    "wallet",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="whitelist_entry",
                        to="wallets.wallet",
                    ),
                ),
            ],
            options={
                "verbose_name": "Whitelist Entry",
                "verbose_name_plural": "Whitelist Entries",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="WhitelistApproval",
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
                ("registry_address", models.CharField(max_length=42)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("active", "Active"),
                            ("removed", "Removed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                (
                    "expires_at",
                    models.DateTimeField(blank=True, help_text="Blank means the approval never expires.", null=True),
                ),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
                    ),
                ),
                (
                    "entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="approvals",
                        to="whitelist.whitelistentry",
                    ),
                ),
            ],
            options={
                "verbose_name": "Whitelist Approval",
                "verbose_name_plural": "Whitelist Approvals",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="companywalletinstructiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_company_wallet_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletinstructiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("instruction",),
                name="one_company_wallet_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletnomination",
            constraint=models.CheckConstraint(
                condition=models.Q(("sharing_accepted", True)), name="wallet_nomination_shared"
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletinstruction",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("action", "add"),
                        ("expires_at__isnull", False),
                        ("nomination__isnull", False),
                        ("target_change__isnull", True),
                    ),
                    models.Q(
                        ("action", "remove"),
                        ("expires_at__isnull", True),
                        ("nomination__isnull", True),
                        ("target_change__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="company_wallet_instruction_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelisteligibilityinvalidation",
            constraint=models.CheckConstraint(
                condition=models.Q(("cause__in", ["standing_loss", "identity_loss", "wallet_removal"])),
                name="whitelist_invalidation_retained_cause",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelisteligibilityinvalidation",
            constraint=models.CheckConstraint(
                condition=models.Q(("chain_id__gt", 0)), name="whitelist_invalidation_chain"
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelisteligibilityinvalidation",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("address__regex", "^0x[0-9a-f]{40}$"),
                        ("cause", "wallet_removal"),
                        ("wallet_id__isnull", False),
                    ),
                    models.Q(
                        models.Q(("cause", "wallet_removal"), _negated=True),
                        ("address", ""),
                        ("wallet_id__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="whitelist_invalidation_wallet_scope",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status__in", ["pending", "executing"])),
                fields=("chain_id", "registry_address", "address"),
                name="one_unresolved_whitelist_change",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(condition=models.Q(("chain_id__gt", 0)), name="whitelist_change_chain"),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("address__regex", "^0x[0-9a-f]{40}$"), ("registry_address__regex", "^0x[0-9a-f]{40}$")
                ),
                name="whitelist_change_addresses",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(("action__in", ["add", "remove"])), name="whitelist_change_action"
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(("action", "add"), ("expires_at__isnull", True), _connector="OR"),
                name="whitelist_change_removal_has_no_expiry",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("authority__in", ["operator_api", "whitelist_admin", "subscription_admin", "refresh", "company"])
                ),
                name="whitelist_change_authority",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["pending", "executing", "confirmed", "unchanged", "failed"])),
                name="whitelist_change_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistentry",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("wallet__isnull", False), models.Q(("address", ""), _negated=True), _connector="OR"
                ),
                name="whitelist_entry_wallet_or_address",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistentry",
            constraint=models.UniqueConstraint(
                condition=models.Q(("wallet__isnull", True)),
                fields=("address",),
                name="whitelist_entry_unique_treasury_address",
            ),
        ),
        migrations.AddIndex(
            model_name="whitelistapproval",
            index=models.Index(fields=["status"], name="whitelist_w_status_67131c_idx"),
        ),
        migrations.AddConstraint(
            model_name="whitelistapproval",
            constraint=models.UniqueConstraint(fields=("entry", "company"), name="one_whitelist_approval_per_company"),
        ),
        migrations.AddConstraint(
            model_name="whitelistapproval",
            constraint=models.CheckConstraint(
                condition=models.Q(("registry_address__regex", "^0x[0-9a-f]{40}$")), name="whitelist_approval_registry"
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistapproval",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["pending", "active", "removed", "failed"])),
                name="whitelist_approval_status",
            ),
        ),
    ]
