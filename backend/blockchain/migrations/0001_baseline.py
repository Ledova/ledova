import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("blockchain", "0001_initial"),
        ("blockchain", "0002_alter_blockchaintransaction_tx_type"),
        ("blockchain", "0003_delete_contractdeployment"),
        ("blockchain", "0004_durable_outgoing"),
        ("blockchain", "0005_legacy_outgoing_inventory"),
        ("blockchain", "0006_signer_admission"),
        ("blockchain", "0007_transaction_outgoing_operation"),
        ("blockchain", "0008_fresh_signer_bootstrap"),
    ]

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="OutgoingOperation",
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
                ("operation_key", models.CharField(editable=False, max_length=200, unique=True)),
                ("intent", models.JSONField(editable=False)),
                ("claim_id", models.UUIDField(editable=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("preparing", "Preparing"),
                            ("signed", "Signed; outcome unresolved"),
                            ("confirmed", "Confirmed"),
                            ("reverted", "Reverted"),
                            ("failed", "Failed before signing"),
                        ],
                        default="preparing",
                        max_length=16,
                    ),
                ),
                ("last_error", models.CharField(blank=True, editable=False, max_length=100)),
                ("acknowledged_at", models.DateTimeField(blank=True, editable=False, null=True)),
                ("block_number", models.PositiveBigIntegerField(blank=True, editable=False, null=True)),
                ("block_hash", models.CharField(blank=True, editable=False, max_length=66)),
                ("gas_used", models.PositiveBigIntegerField(blank=True, editable=False, null=True)),
            ],
        ),
        migrations.CreateModel(
            name="OutgoingHistoryCapture",
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
                ("validator_version", models.CharField(editable=False, max_length=32)),
                ("scope", models.JSONField(editable=False)),
                ("manifest_digest", models.CharField(editable=False, max_length=64)),
                ("snapshot_at", models.DateTimeField(editable=False)),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("manifest_digest__regex", "^[0-9a-f]{64}$")), name="history_capture_digest"
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="SignedAttempt",
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
                ("claim_id", models.UUIDField(editable=False)),
                ("nonce", models.PositiveBigIntegerField(editable=False)),
                ("tx_hash", models.CharField(editable=False, max_length=66, unique=True)),
                ("raw_transaction", models.BinaryField()),
                (
                    "operation",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="attempts",
                        to="blockchain.outgoingoperation",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="outgoingoperation",
            name="current_attempt",
            field=models.ForeignKey(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="blockchain.signedattempt",
            ),
        ),
        migrations.CreateModel(
            name="SigningAccount",
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
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("address", models.CharField(editable=False, max_length=42)),
                ("next_nonce", models.PositiveBigIntegerField(default=0, editable=False)),
                (
                    "admission_state",
                    models.CharField(
                        choices=[("closed", "Closed"), ("admitted", "Admitted")],
                        default="closed",
                        editable=False,
                        max_length=8,
                    ),
                ),
                ("admission_generation", models.PositiveBigIntegerField(default=0, editable=False)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("chain_id", "address"), name="unique_outgoing_signer"),
                    models.CheckConstraint(
                        condition=models.Q(("address__regex", "^0x[0-9a-f]{40}$")), name="outgoing_signer_address"
                    ),
                    models.CheckConstraint(condition=models.Q(("chain_id__gt", 0)), name="outgoing_signer_chain"),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("admission_state", "closed"),
                            models.Q(
                                ("admission_generation__gt", 0),
                                ("admission_generation__lt", 9223372036854775807),
                                ("admission_state", "admitted"),
                            ),
                            _connector="OR",
                        ),
                        name="outgoing_signer_admission",
                    ),
                ],
            },
        ),
        migrations.AddField(
            model_name="signedattempt",
            name="signer",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="attempts",
                to="blockchain.signingaccount",
            ),
        ),
        migrations.CreateModel(
            name="FreshSignerBootstrap",
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
                ("manifest_digest", models.CharField(editable=False, max_length=64, unique=True)),
                ("validator_version", models.CharField(editable=False, max_length=32)),
                ("manifest", models.JSONField(editable=False)),
                ("artifact_identities", models.JSONField(editable=False)),
                ("chain_evidence", models.JSONField(editable=False)),
                (
                    "signer",
                    models.OneToOneField(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bootstrap",
                        to="blockchain.signingaccount",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="OutgoingCutoverHold",
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
                    "scope",
                    models.CharField(
                        choices=[("signer", "signer"), ("chain", "chain"), ("deployment", "deployment")],
                        editable=False,
                        max_length=16,
                    ),
                ),
                ("observed_chain_id", models.CharField(editable=False, max_length=78, null=True)),
                ("observed_sender", models.CharField(editable=False, max_length=42, null=True)),
                ("hold_key", models.CharField(editable=False, max_length=64)),
                (
                    "reason",
                    models.CharField(
                        choices=[
                            ("missing_raw_payload", "missing_raw_payload"),
                            ("malformed_journal", "malformed_journal"),
                            ("malformed_raw_payload", "malformed_raw_payload"),
                            ("unsupported_envelope", "unsupported_envelope"),
                            ("unsupported_integer_range", "unsupported_integer_range"),
                            ("invalid_signature", "invalid_signature"),
                            ("recorded_hash_mismatch", "recorded_hash_mismatch"),
                            ("mint_terms_mismatch", "mint_terms_mismatch"),
                            ("invalid_source_link", "invalid_source_link"),
                            ("invalid_attempt_identity", "invalid_attempt_identity"),
                            ("current_hash_mismatch", "current_hash_mismatch"),
                            ("missing_chain_provenance", "missing_chain_provenance"),
                            ("missing_signer_authorization", "missing_signer_authorization"),
                            ("unsigned_inflight_snapshot", "unsigned_inflight_snapshot"),
                            ("nonce_payload_conflict", "nonce_payload_conflict"),
                            ("hash_operation_conflict", "hash_operation_conflict"),
                            ("source_identity_conflict", "source_identity_conflict"),
                            ("unjournaled_pause_and_approval", "unjournaled_pause_and_approval"),
                            ("offline_and_old_signers_not_observed", "offline_and_old_signers_not_observed"),
                        ],
                        editable=False,
                        max_length=64,
                    ),
                ),
                ("evidence_refs", models.JSONField(default=list, editable=False)),
                (
                    "capture",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="holds",
                        to="blockchain.outgoinghistorycapture",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("capture", "hold_key"), name="unique_history_capture_hold"),
                    models.CheckConstraint(
                        condition=models.Q(("hold_key__regex", "^[0-9a-f]{64}$")), name="history_hold_digest"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            (
                                "reason__in",
                                (
                                    "missing_raw_payload",
                                    "malformed_journal",
                                    "malformed_raw_payload",
                                    "unsupported_envelope",
                                    "unsupported_integer_range",
                                    "invalid_signature",
                                    "recorded_hash_mismatch",
                                    "mint_terms_mismatch",
                                    "invalid_source_link",
                                    "invalid_attempt_identity",
                                    "current_hash_mismatch",
                                    "missing_chain_provenance",
                                    "missing_signer_authorization",
                                    "unsigned_inflight_snapshot",
                                    "nonce_payload_conflict",
                                    "hash_operation_conflict",
                                    "source_identity_conflict",
                                    "unjournaled_pause_and_approval",
                                    "offline_and_old_signers_not_observed",
                                ),
                            )
                        ),
                        name="history_hold_reason",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            models.Q(
                                ("observed_chain_id__isnull", True),
                                ("observed_sender__isnull", True),
                                ("scope", "deployment"),
                            ),
                            models.Q(
                                ("observed_chain_id__isnull", False),
                                ("observed_sender__isnull", True),
                                ("scope", "chain"),
                            ),
                            models.Q(
                                ("observed_chain_id__isnull", False),
                                ("observed_sender__isnull", False),
                                ("scope", "signer"),
                            ),
                            _connector="OR",
                        ),
                        name="history_hold_scope_identity",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("observed_chain_id__isnull", True),
                            ("observed_chain_id__regex", "^[1-9][0-9]{0,77}$"),
                            _connector="OR",
                        ),
                        name="history_hold_chain",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("observed_sender__isnull", True),
                            ("observed_sender__regex", "^0x[0-9a-f]{40}$"),
                            _connector="OR",
                        ),
                        name="history_hold_sender",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="OutgoingHistoryEvidence",
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
                ("source_model", models.CharField(editable=False, max_length=100)),
                ("source_uuid", models.UUIDField(editable=False)),
                ("entry_key", models.CharField(editable=False, max_length=100)),
                ("source_fingerprint", models.CharField(editable=False, max_length=64)),
                ("identity_fingerprint", models.CharField(editable=False, max_length=64)),
                ("source_snapshot", models.JSONField(editable=False)),
                ("operation_key", models.CharField(blank=True, editable=False, max_length=200)),
                ("raw_transaction", models.BinaryField(null=True)),
                ("observed_hash", models.CharField(blank=True, editable=False, max_length=66)),
                ("observed_chain_id", models.CharField(editable=False, max_length=78, null=True)),
                ("observed_sender", models.CharField(editable=False, max_length=42, null=True)),
                ("observed_nonce", models.CharField(editable=False, max_length=78, null=True)),
                ("expected_terms", models.JSONField(default=dict, editable=False)),
                ("decoded_intent", models.JSONField(default=dict, editable=False)),
                ("raw_valid", models.BooleanField(default=False, editable=False)),
                ("terms_match", models.BooleanField(default=False, editable=False)),
                ("source_link_valid", models.BooleanField(default=False, editable=False)),
                ("proved_unsigned", models.BooleanField(default=False, editable=False)),
                ("findings", models.JSONField(default=list, editable=False)),
                (
                    "capture",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="evidence",
                        to="blockchain.outgoinghistorycapture",
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["observed_chain_id", "observed_sender", "observed_nonce"],
                        name="history_observed_nonce_idx",
                    ),
                    models.Index(fields=["observed_hash"], name="history_observed_hash_idx"),
                    models.Index(fields=["source_model", "source_uuid", "entry_key"], name="history_source_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("capture", "source_model", "source_uuid", "entry_key", "source_fingerprint"),
                        name="unique_history_source_observation",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("identity_fingerprint__regex", "^[0-9a-f]{64}$"),
                            ("source_fingerprint__regex", "^[0-9a-f]{64}$"),
                        ),
                        name="history_evidence_digests",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("observed_hash", ""), ("observed_hash__regex", "^0x[0-9a-f]{64}$"), _connector="OR"
                        ),
                        name="history_observed_hash",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("observed_chain_id__isnull", True),
                            ("observed_chain_id__regex", "^[1-9][0-9]{0,77}$"),
                            _connector="OR",
                        ),
                        name="history_observed_chain",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("observed_sender__isnull", True),
                            ("observed_sender__regex", "^0x[0-9a-f]{40}$"),
                            _connector="OR",
                        ),
                        name="history_observed_sender",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("observed_nonce__isnull", True),
                            ("observed_nonce__regex", "^(0|[1-9][0-9]{0,77})$"),
                            _connector="OR",
                        ),
                        name="history_observed_nonce",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("raw_valid", False),
                            models.Q(
                                ("observed_chain_id__isnull", False),
                                ("observed_hash__regex", "^0x[0-9a-f]{64}$"),
                                ("observed_nonce__isnull", False),
                                ("observed_sender__isnull", False),
                                ("raw_transaction__isnull", False),
                            ),
                            _connector="OR",
                        ),
                        name="history_valid_raw_has_identity",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("terms_match", False),
                            models.Q(
                                ("raw_valid", True),
                                models.Q(("expected_terms", {}), _negated=True),
                                models.Q(("decoded_intent", {}), _negated=True),
                            ),
                            _connector="OR",
                        ),
                        name="history_matching_terms_have_raw",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("source_link_valid", False),
                            models.Q(("operation_key", ""), _negated=True),
                            _connector="OR",
                        ),
                        name="history_link_has_operation",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("proved_unsigned", False),
                            models.Q(
                                ("observed_chain_id__isnull", True),
                                ("observed_hash", ""),
                                ("observed_nonce__isnull", True),
                                ("observed_sender__isnull", True),
                                ("raw_transaction__isnull", True),
                                ("raw_valid", False),
                                ("source_link_valid", True),
                            ),
                            _connector="OR",
                        ),
                        name="history_unsigned_has_no_payload",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="BlockchainTransaction",
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
                ("tx_hash", models.CharField(blank=True, max_length=66, null=True, unique=True)),
                (
                    "tx_type",
                    models.CharField(
                        choices=[
                            ("whitelist_add", "Add to Whitelist"),
                            ("whitelist_remove", "Remove from Whitelist"),
                            ("whitelist_update", "Update Investor Type"),
                            ("token_deploy", "Deploy Token"),
                            ("token_mint", "Mint Tokens"),
                            ("token_transfer", "Transfer Tokens"),
                            ("token_burn", "Burn Tokens"),
                            ("stablecoin_mint", "Mint Stablecoin"),
                            ("stablecoin_burn", "Burn Stablecoin"),
                            ("yield_token_mint", "Mint Yield Token"),
                            ("yield_token_nav_update", "Update Yield Token NAV"),
                            ("atomic_swap", "Atomic Swap"),
                            ("share_token_deploy", "Deploy Share Token"),
                            ("contract_deploy", "Deploy Contract"),
                            ("other", "Other"),
                        ],
                        default="other",
                        max_length=30,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("submitted", "Submitted"),
                            ("confirmed", "Confirmed"),
                            ("failed", "Failed"),
                            ("reverted", "Reverted"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("from_address", models.CharField(max_length=42)),
                ("to_address", models.CharField(blank=True, max_length=42, null=True)),
                ("value", models.DecimalField(decimal_places=18, default=0, max_digits=36)),
                ("gas_limit", models.PositiveIntegerField(blank=True, null=True)),
                ("gas_price", models.DecimalField(blank=True, decimal_places=18, max_digits=36, null=True)),
                ("gas_used", models.PositiveIntegerField(blank=True, null=True)),
                ("nonce", models.PositiveIntegerField(blank=True, null=True)),
                ("block_number", models.PositiveIntegerField(blank=True, null=True)),
                ("block_hash", models.CharField(blank=True, max_length=66, null=True)),
                ("function_name", models.CharField(blank=True, max_length=100, null=True)),
                ("function_args", models.JSONField(blank=True, null=True)),
                ("error_message", models.TextField(blank=True)),
                ("retry_count", models.PositiveSmallIntegerField(default=0)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("related_model", models.CharField(blank=True, max_length=100, null=True)),
                ("related_uuid", models.UUIDField(blank=True, null=True)),
                (
                    "outgoing_operation",
                    models.OneToOneField(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="swap_transaction",
                        to="blockchain.outgoingoperation",
                    ),
                ),
            ],
            options={
                "verbose_name": "Blockchain Transaction",
                "verbose_name_plural": "Blockchain Transactions",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["tx_hash"], name="blockchain__tx_hash_7a315c_idx"),
                    models.Index(fields=["status"], name="blockchain__status_096a5b_idx"),
                    models.Index(fields=["tx_type"], name="blockchain__tx_type_6dc441_idx"),
                    models.Index(fields=["from_address"], name="blockchain__from_ad_121d3a_idx"),
                    models.Index(fields=["to_address"], name="blockchain__to_addr_9aa631_idx"),
                    models.Index(fields=["block_number"], name="blockchain__block_n_035750_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("function_args__has_key", "admission"), ("tx_type", "atomic_swap")),
                        fields=("related_uuid",),
                        name="unique_admitted_swap_transaction",
                    )
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="outgoingoperation",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("current_attempt__isnull", True), ("status__in", ["preparing", "failed"])),
                    models.Q(("current_attempt__isnull", False), ("status__in", ["signed", "confirmed", "reverted"])),
                    _connector="OR",
                ),
                name="outgoing_status_has_attempt",
            ),
        ),
        migrations.AddConstraint(
            model_name="signedattempt",
            constraint=models.UniqueConstraint(fields=("signer", "nonce"), name="unique_outgoing_signer_nonce"),
        ),
        migrations.AddConstraint(
            model_name="signedattempt",
            constraint=models.UniqueConstraint(fields=("operation", "claim_id"), name="unique_outgoing_signed_claim"),
        ),
        migrations.AddConstraint(
            model_name="signedattempt",
            constraint=models.CheckConstraint(
                condition=models.Q(("tx_hash__regex", "^0x[0-9a-f]{64}$")), name="outgoing_attempt_hash"
            ),
        ),
        migrations.AddConstraint(
            model_name="freshsignerbootstrap",
            constraint=models.CheckConstraint(
                condition=models.Q(("manifest_digest__regex", "^[0-9a-f]{64}$")), name="fresh_signer_manifest_digest"
            ),
        ),
    ]
