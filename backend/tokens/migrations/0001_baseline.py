import uuid

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
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

    replaces = [
        ("tokens", "0001_initial"),
        ("tokens", "0002_yield_token_and_nav"),
        ("tokens", "0003_unify_mint_request"),
        ("tokens", "0004_seed_ausg_yield_token"),
        ("tokens", "0005_rename_token_issuance_to_share_issuance"),
        ("tokens", "0006_rename_tokens_stab_status_4c5fd9_idx_tokens_mint_status_99ebab_idx_and_more"),
        ("tokens", "0007_stablecoin_reserve_fields"),
        ("tokens", "0008_share_issuance_request"),
        ("tokens", "0009_transferorder_ownership"),
        ("tokens", "0010_transferorder_bind_legacy_orders"),
        ("tokens", "0011_transferorder_owner_required"),
        ("tokens", "0012_reviewable_request"),
        ("tokens", "0013_remove_transferorder_signature_request"),
        ("tokens", "0014_settlement_asset_columns"),
        ("tokens", "0015_fold_stablecoin_into_asset"),
        ("tokens", "0016_drop_stablecoin"),
        ("tokens", "0017_share_token_chain"),
        ("tokens", "0018_protect_the_register_spine"),
        ("tokens", "0019_signing_challenge"),
        ("tokens", "0020_shareissuance_identity_stamped_at_and_more"),
        ("tokens", "0021_modification_log_names_its_challenge"),
        ("tokens", "0022_swap_nonce_is_unique"),
        ("tokens", "0023_r0_owner_columns"),
        ("tokens", "0024_r0_sharetoken_owner"),
        ("tokens", "0025_a_token_cannot_change_company"),
        ("tokens", "0026_one_capital_increase_in_flight"),
        ("tokens", "0029_execution_notes"),
        ("tokens", "0030_superseded_capital_increase"),
        ("tokens", "0031_share_tokens_have_zero_decimals"),
        ("tokens", "0032_former_holders"),
        ("tokens", "0033_the_fold_records_where_it_reached"),
        ("tokens", "0034_shareissuance_mint_journal"),
        ("tokens", "0035_trading_state_invariants"),
        ("tokens", "0036_swap_expiry_eligibility"),
        ("tokens", "0037_order_submissions"),
        ("tokens", "0038_order_action_submissions"),
        ("tokens", "0039_swap_settlement_context"),
        ("tokens", "0040_swap_parent_identity"),
        ("tokens", "0041_drop_the_token_owner_no_policy_reads"),
        ("tokens", "0042_mint_request_operations"),
        ("tokens", "0043_token_deployment"),
        ("tokens", "0044_token_deployment_guards"),
        ("tokens", "0045_capital_increase_execution"),
        ("tokens", "0046_capital_execution_guards"),
        ("tokens", "0047_issuance_execution"),
        ("tokens", "0048_issuance_execution_guards"),
        ("tokens", "0049_swap_approval_phase"),
        ("tokens", "0050_swap_approval_guards"),
        ("tokens", "0051_pause_change"),
        ("tokens", "0052_pause_change_guards"),
        ("tokens", "0053_nav_update_recovery"),
        ("tokens", "0054_nav_update_guards"),
        ("tokens", "0055_order_submission_settlement_refusal"),
        ("tokens", "0056_hold_legacy_swaps"),
        ("tokens", "0057_swap_execution_guards"),
        ("tokens", "0058_swap_finality_completion"),
        ("tokens", "0059_swap_approval_submission"),
        ("tokens", "0060_order_submission_settlement_chain_refusal"),
        ("tokens", "0061_swap_approval_recovery_index"),
        ("tokens", "0062_register_foundation"),
        ("tokens", "0063_swap_finalized_receipt"),
        ("tokens", "0064_reviewed_register_corrections"),
        ("tokens", "0065_register_opening"),
        ("tokens", "0066_issuance_finality_and_boundary_history"),
        ("tokens", "0067_register_wallet_links"),
        ("tokens", "0068_completion_transaction_index"),
        ("tokens", "0069_opening_mapping_values"),
        ("tokens", "0070_register_reconciliation"),
        ("tokens", "0071_register_export_audit"),
        ("tokens", "0072_register_import"),
        ("tokens", "0073_register_instructions"),
        ("tokens", "0074_register_inspection_copies"),
        ("tokens", "0075_register_certificates"),
        ("tokens", "0076_transfer_instructions"),
        ("tokens", "0077_import_opening"),
        ("tokens", "0078_register_notice_figures"),
        ("tokens", "0079_order_submission_eligibility_refusal"),
        ("tokens", "0080_company_pack"),
        ("tokens", "0081_held_orders_and_retired_statuses"),
        ("tokens", "0082_company_eligibility_admission"),
        ("tokens", "0083_company_register_imports"),
        ("tokens", "0084_company_register_import_guards"),
        ("tokens", "0085_company_register_corrections"),
        ("tokens", "0086_company_register_correction_guards"),
        ("tokens", "0087_company_discrepancy_acknowledgements"),
        ("tokens", "0088_company_register_openings"),
        ("tokens", "0089_company_register_opening_guards"),
        ("tokens", "0090_company_particulars_changes"),
        ("tokens", "0091_company_particulars_change_guards"),
        ("tokens", "0092_company_register_wallet_links"),
        ("tokens", "0093_company_register_wallet_link_guards"),
        ("tokens", "0094_company_register_grants"),
        ("tokens", "0095_company_register_grant_guards"),
        ("tokens", "0096_company_register_transfers"),
        ("tokens", "0097_company_register_transfer_guards"),
        ("tokens", "0098_company_register_deployments"),
        ("tokens", "0099_company_register_deployment_guards"),
        ("tokens", "0100_company_register_issue_instructions"),
        ("tokens", "0101_company_register_issue_guards"),
        ("tokens", "0102_company_register_capital_increases"),
        ("tokens", "0103_company_register_capital_guards"),
        ("tokens", "0104_company_register_pause_changes"),
        ("tokens", "0105_company_register_pause_guards"),
        ("tokens", "0106_company_register_paid_issues"),
    ]

    initial = True

    dependencies = [
        ("assets", "0001_baseline"),
        ("authentication", "__first__"),
        ("blockchain", "0001_baseline"),
        ("companies", "0001_baseline"),
    ]

    operations = [
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
            ],
            options={
                "ordering": ["-ceased_on", "name"],
            },
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
            ],
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
            ],
            options={
                "verbose_name": "Order Modification Log",
                "verbose_name_plural": "Order Modification Logs",
                "ordering": ["-created_at"],
            },
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
            ],
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
            ],
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
                ("idempotency_key", models.UUIDField(editable=False, null=True)),
            ],
            options={
                "ordering": ["created_at", "uuid"],
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
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
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
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
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
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
                        ],
                        max_length=16,
                    ),
                ),
                ("effective_on", models.DateField()),
                ("changes", models.JSONField()),
                ("previous_hash", models.CharField(blank=True, editable=False, max_length=64)),
                ("entry_hash", models.CharField(blank=True, editable=False, max_length=64)),
            ],
            options={
                "ordering": ["sequence"],
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
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
                ("members", models.JSONField()),
                ("former_members", models.JSONField()),
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
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
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
            ],
            options={
                "abstract": False,
            },
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
            ],
            options={
                "ordering": ["-ceased_on", "-entry__sequence", "member_id"],
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
            ],
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
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
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
            ],
            options={
                "ordering": ["decided_at", "uuid"],
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
            ],
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
            ],
            options={
                "verbose_name": "Share Issuance",
                "verbose_name_plural": "Share Issuances",
                "ordering": ["-created_at"],
            },
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
                ("subscription_id", models.UUIDField(editable=False, null=True, unique=True)),
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
                            ("cancelled", "Cancelled before execution"),
                        ],
                        default="queued",
                        max_length=12,
                    ),
                ),
                ("finalized_receipt", models.JSONField(editable=False, null=True)),
                ("retry_of", models.UUIDField(editable=False, null=True)),
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
            ],
            options={
                "verbose_name": "Share Issuance Request",
                "verbose_name_plural": "Share Issuance Requests",
                "ordering": ["-created_at"],
                "abstract": False,
            },
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
            ],
            options={
                "abstract": False,
            },
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
            ],
            options={
                "verbose_name": "Share Token",
                "verbose_name_plural": "Share Tokens",
                "ordering": ["-created_at"],
            },
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
            ],
            options={
                "db_table": "signing_challenges",
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
            ],
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
            ],
            options={
                "verbose_name": "Swap Order",
                "verbose_name_plural": "Swap Orders",
                "ordering": ["-created_at"],
            },
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
            ],
            options={
                "verbose_name": "Transfer Order",
                "verbose_name_plural": "Transfer Orders",
                "ordering": ["-created_at"],
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
            ],
            options={
                "ordering": ["created_at"],
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
            ],
            options={
                "verbose_name": "Former holder",
                "verbose_name_plural": "Former holders",
                "db_table": "tokens_formerholder",
                "ordering": ["-ceased_on", "wallet_address"],
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
            ],
            options={
                "verbose_name": "Mint Request",
                "verbose_name_plural": "Mint Requests",
                "ordering": ["-created_at"],
            },
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
            ],
            options={
                "verbose_name": "NAV Update",
                "verbose_name_plural": "NAV Updates",
                "ordering": ["-created_at"],
            },
        ),
    ]
