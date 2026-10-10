import uuid

import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("wallets", "0001_initial"),
        ("wallets", "0002_wallet_wallet_type"),
        ("wallets", "0003_update_fiat_transaction_provider_to_transak"),
        ("wallets", "0004_wallet_is_operator"),
        ("wallets", "0005_alter_holdingsnapshot_snapshot_reason"),
        ("wallets", "0006_delete_fiattransaction_drop_unread_columns"),
        ("wallets", "0007_transaction_deducted_amount_transaction_deducted_fee"),
        ("wallets", "0008_r0_owner_column"),
        ("wallets", "0009_trigger_follows_and_refuses"),
        ("wallets", "0010_durable_state_for_a_submitted_transaction"),
        ("wallets", "0011_wallet_verification_challenge_issued_at"),
        ("wallets", "0012_balance_versions"),
        ("wallets", "0013_signing_preference"),
        ("wallets", "0014_wallet_network_identity"),
        ("wallets", "0015_transaction_imported_from_history"),
        ("wallets", "0016_wallet_submission"),
        ("wallets", "0017_bitcoin_submission"),
        ("wallets", "0018_global_submission_identity"),
        ("wallets", "0019_chain_observations"),
        ("wallets", "0020_transaction_monitoring_completed_at"),
        ("wallets", "0021_transaction_finality_observation"),
        ("wallets", "0022_delete_holdingsnapshot"),
        ("wallets", "0023_transaction_market_value_aud"),
        ("wallets", "0024_wallet_possession_proof"),
        ("wallets", "0025_wallet_possession_proof_guards"),
    ]

    initial = True

    dependencies = [
        ("assets", "0001_baseline"),
        ("authentication", "__first__"),
        ("users", "0001_baseline"),
    ]

    operations = [
        migrations.CreateModel(
            name="Wallet",
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
                ("name", models.CharField(blank=True, max_length=100, null=True)),
                ("address", models.CharField(db_index=True, max_length=255)),
                (
                    "chain",
                    models.CharField(
                        choices=[
                            ("ethereum", "ETHEREUM"),
                            ("bitcoin", "BITCOIN"),
                            ("polygon", "POLYGON"),
                            ("solana", "SOLANA"),
                            ("avalanche", "AVALANCHE"),
                            ("arbitrum", "ARBITRUM"),
                            ("optimism", "OPTIMISM"),
                            ("base", "BASE"),
                        ],
                        db_index=True,
                        max_length=20,
                    ),
                ),
                (
                    "signing_preference",
                    models.CharField(
                        blank=True,
                        choices=[("hardware", "Hardware"), ("software", "Software")],
                        help_text="Self-declared signing preference. It does not attest custody or hardware use.",
                        max_length=16,
                        null=True,
                    ),
                ),
                (
                    "verification_status",
                    models.CharField(
                        choices=[("PENDING", "Pending Verification"), ("VERIFIED", "Verified")],
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("verification_challenge", models.TextField(blank=True, null=True)),
                ("verification_challenge_issued_at", models.DateTimeField(blank=True, null=True)),
                ("verification_signature", models.TextField(blank=True, null=True)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                (
                    "derivation_path",
                    models.CharField(
                        blank=True,
                        help_text="Full BIP44 derivation path to this address (e.g., m/44'/60'/0'/0/0)",
                        max_length=100,
                        null=True,
                    ),
                ),
                (
                    "master_fingerprint",
                    models.CharField(
                        blank=True,
                        help_text="Client-provided key fingerprint (8-char hex); not hardware attestation",
                        max_length=8,
                        null=True,
                    ),
                ),
                (
                    "address_index",
                    models.IntegerField(
                        blank=True,
                        help_text="Index of this address in the derivation sequence (0, 1, 2, ...)",
                        null=True,
                    ),
                ),
                (
                    "parent_public_key",
                    models.CharField(
                        blank=True,
                        help_text="Public key at external chain level (33-byte compressed, hex)",
                        max_length=66,
                        null=True,
                    ),
                ),
                (
                    "parent_chain_code",
                    models.CharField(
                        blank=True,
                        help_text="Chain code at external chain level (32-byte, hex)",
                        max_length=64,
                        null=True,
                    ),
                ),
                (
                    "parent_derivation_path",
                    models.CharField(
                        blank=True,
                        help_text="Derivation path of the parent key (e.g., m/44'/60'/0'/0)",
                        max_length=100,
                        null=True,
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="wallets", to="users.useraccount"
                    ),
                ),
            ],
            options={
                "verbose_name": "Wallet",
                "verbose_name_plural": "Wallets",
                "db_table": "wallets",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Transaction",
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
                ("tx_hash", models.CharField(db_index=True, max_length=255)),
                (
                    "chain",
                    models.CharField(
                        choices=[
                            ("ethereum", "ETHEREUM"),
                            ("bitcoin", "BITCOIN"),
                            ("polygon", "POLYGON"),
                            ("solana", "SOLANA"),
                            ("avalanche", "AVALANCHE"),
                            ("arbitrum", "ARBITRUM"),
                            ("optimism", "OPTIMISM"),
                            ("base", "BASE"),
                        ],
                        db_index=True,
                        max_length=20,
                    ),
                ),
                ("from_address", models.CharField(db_index=True, max_length=255)),
                ("to_address", models.CharField(blank=True, db_index=True, max_length=255, null=True)),
                ("amount", models.DecimalField(decimal_places=18, max_digits=30)),
                (
                    "market_value",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="USD value at transaction time (amount × asset price at block_timestamp)",
                        max_digits=30,
                        null=True,
                    ),
                ),
                (
                    "market_value_aud",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="AUD value at transaction time, which transaction monitoring compares with its AUD thresholds: the USD value at the USD/AUD rate stored when the transaction was recorded, or amount × par for an asset with an AUD par",
                        max_digits=30,
                        null=True,
                    ),
                ),
                ("block_timestamp", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("block_number", models.BigIntegerField(blank=True, null=True)),
                (
                    "block_hash",
                    models.CharField(
                        blank=True,
                        help_text="Hash of the block this landed in, so a reorganisation that replaced it can be seen",
                        max_length=255,
                        null=True,
                    ),
                ),
                (
                    "nonce",
                    models.BigIntegerField(
                        blank=True,
                        db_index=True,
                        help_text="Sender's nonce for this broadcast, which is what ties a replacement to what it replaced",
                        null=True,
                    ),
                ),
                (
                    "replaced_by_tx_hash",
                    models.CharField(
                        blank=True,
                        db_index=True,
                        help_text="The hash that landed instead of this one, for a speed-up or a cancellation",
                        max_length=255,
                        null=True,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("confirmed", "Confirmed"),
                            ("failed", "Failed"),
                            ("reorged", "Confirmed, then dropped by a chain reorganisation"),
                            ("replaced", "Replaced by another transaction that landed instead"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("imported_from_history", models.BooleanField(default=False, editable=False)),
                ("monitoring_completed_at", models.DateTimeField(blank=True, editable=False, null=True)),
                (
                    "transaction_fee_estimated",
                    models.DecimalField(blank=True, decimal_places=18, max_digits=30, null=True),
                ),
                ("transaction_fee", models.DecimalField(blank=True, decimal_places=18, max_digits=30, null=True)),
                (
                    "deducted_amount",
                    models.DecimalField(
                        blank=True,
                        decimal_places=18,
                        help_text="What the optimistic deduction actually took from the asset's holding, after the floor at zero. Carries the fee as well when the asset is the chain's native coin. Null for rows written before the deduction was recorded.",
                        max_digits=30,
                        null=True,
                    ),
                ),
                (
                    "deducted_fee",
                    models.DecimalField(
                        blank=True,
                        decimal_places=18,
                        help_text="What the optimistic deduction actually took from the native holding, after the floor at zero. Null when the asset is itself native, and for rows written before the deduction was recorded.",
                        max_digits=30,
                        null=True,
                    ),
                ),
                ("deducted_amount_sync_version", models.UUIDField(blank=True, editable=False, null=True)),
                ("deducted_fee_sync_version", models.UUIDField(blank=True, editable=False, null=True)),
                ("balance_reconciliation_token", models.UUIDField(blank=True, editable=False, null=True)),
                (
                    "asset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="transactions", to="assets.asset"
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        help_text="Owner, derived from wallet.user_account and held directly so a row-level security policy can read it",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to="users.useraccount",
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="transactions", to="wallets.wallet"
                    ),
                ),
            ],
            options={
                "verbose_name": "Transaction",
                "verbose_name_plural": "Transactions",
                "db_table": "transactions",
                "ordering": ["-block_timestamp"],
            },
        ),
        migrations.CreateModel(
            name="Holding",
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
                ("quantity", models.DecimalField(decimal_places=18, max_digits=40)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("balance_version", models.UUIDField(default=uuid.uuid4, editable=False)),
                ("sync_version", models.UUIDField(default=uuid.uuid4, editable=False)),
                (
                    "asset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="holdings", to="assets.asset"
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="holdings", to="wallets.wallet"
                    ),
                ),
            ],
            options={
                "verbose_name": "Holding",
                "verbose_name_plural": "Holdings",
                "db_table": "holdings",
                "ordering": ["-quantity"],
            },
        ),
        migrations.CreateModel(
            name="BitcoinSubmission",
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
                    "network",
                    models.CharField(choices=[("test", "test"), ("regtest", "regtest")], editable=False, max_length=10),
                ),
                ("genesis_hash", models.CharField(editable=False, max_length=64)),
                ("sender_address", models.CharField(editable=False, max_length=255)),
                ("tx_hash", models.CharField(editable=False, max_length=64)),
                ("witness_hash", models.CharField(editable=False, max_length=64)),
                ("raw_transaction", models.BinaryField()),
                ("intent", models.JSONField(editable=False)),
                ("last_attempt_at", models.DateTimeField(db_index=True, editable=False, null=True)),
                ("acknowledged_at", models.DateTimeField(editable=False, null=True)),
                (
                    "asset",
                    models.ForeignKey(
                        editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="assets.asset"
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.useraccount",
                    ),
                ),
                (
                    "transaction",
                    models.OneToOneField(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bitcoin_submission",
                        to="wallets.transaction",
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bitcoin_submissions",
                        to="wallets.wallet",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="WalletChainObservation",
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
                ("generation", models.PositiveBigIntegerField(editable=False)),
                ("target_fingerprint", models.CharField(editable=False, max_length=64)),
                ("started_at", models.DateTimeField(editable=False)),
                (
                    "result",
                    models.CharField(
                        choices=[("unknown", "Unknown"), ("included", "Included"), ("orphaned", "Orphaned")],
                        editable=False,
                        max_length=16,
                    ),
                ),
                (
                    "finality",
                    models.CharField(
                        choices=[("unknown", "Unknown"), ("waiting", "Waiting"), ("satisfied", "Policy satisfied")],
                        editable=False,
                        max_length=16,
                    ),
                ),
                ("reason", models.CharField(blank=True, editable=False, max_length=64)),
                ("policy", models.JSONField(default=dict, editable=False)),
                ("evidence", models.JSONField(default=dict, editable=False)),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
                    ),
                ),
            ],
            options={
                "ordering": ["-generation"],
            },
        ),
        migrations.AddField(
            model_name="transaction",
            name="finality_observation",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="wallets.walletchainobservation",
            ),
        ),
        migrations.CreateModel(
            name="WalletChainWatch",
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
                ("chain", models.CharField(editable=False, max_length=20)),
                ("network", models.CharField(editable=False, max_length=80)),
                ("tx_hash", models.CharField(editable=False, max_length=66)),
                ("generation", models.PositiveBigIntegerField(default=0, editable=False)),
                ("target_fingerprint", models.CharField(blank=True, editable=False, max_length=64)),
                ("last_started_at", models.DateTimeField(db_index=True, editable=False, null=True)),
                ("last_completed_at", models.DateTimeField(editable=False, null=True)),
                (
                    "latest_observation",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="wallets.walletchainobservation",
                    ),
                ),
                (
                    "transaction",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="chain_watch",
                        to="wallets.transaction",
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="chain_watches", to="wallets.wallet"
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="walletchainobservation",
            name="watch",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="observations", to="wallets.walletchainwatch"
            ),
        ),
        migrations.CreateModel(
            name="WalletPossessionProof",
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
                ("account_id", models.UUIDField(editable=False)),
                ("profile_id", models.UUIDField(editable=False)),
                ("address", models.CharField(editable=False, max_length=100)),
                ("chain", models.CharField(editable=False, max_length=20)),
                ("challenge", models.TextField(editable=False)),
                ("challenge_issued_at", models.DateTimeField(editable=False)),
                ("challenge_expires_at", models.DateTimeField(editable=False)),
                ("signature", models.TextField(editable=False)),
                ("completed_at", models.DateTimeField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                (
                    "verified_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "ordering": ["-completed_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="WalletSubmission",
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
                ("chain", models.CharField(editable=False, max_length=20)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("sender_address", models.CharField(editable=False, max_length=42)),
                ("nonce", models.PositiveBigIntegerField(editable=False)),
                ("tx_hash", models.CharField(editable=False, max_length=66)),
                ("raw_transaction", models.BinaryField()),
                ("intent", models.JSONField(editable=False)),
                ("last_attempt_at", models.DateTimeField(db_index=True, editable=False, null=True)),
                ("acknowledged_at", models.DateTimeField(editable=False, null=True)),
                (
                    "asset",
                    models.ForeignKey(
                        editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="assets.asset"
                    ),
                ),
                (
                    "deployment",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="assets.assetchaindeployment",
                    ),
                ),
                (
                    "transaction",
                    models.OneToOneField(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="submission",
                        to="wallets.transaction",
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.useraccount",
                    ),
                ),
                (
                    "wallet",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="submissions",
                        to="wallets.wallet",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="BitcoinSubmissionInput",
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
                ("network", models.CharField(editable=False, max_length=10)),
                ("previous_tx_hash", models.CharField(editable=False, max_length=64)),
                ("output_index", models.PositiveBigIntegerField(editable=False)),
                ("satoshis", models.PositiveBigIntegerField(editable=False)),
                ("script", models.BinaryField()),
                ("observed_block_hash", models.CharField(editable=False, max_length=64)),
                (
                    "submission",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="inputs",
                        to="wallets.bitcoinsubmission",
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.useraccount",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("network", "previous_tx_hash", "output_index"), name="unique_bitcoin_submission_input"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("output_index__lt", 4294967296)), name="bitcoin_submission_input_index"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("satoshis__lte", 2100000000000000)), name="bitcoin_input_value"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("previous_tx_hash__regex", "^[0-9a-f]{64}$")), name="bitcoin_input_hash"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("observed_block_hash__regex", "^[0-9a-f]{64}$")), name="bitcoin_input_block"
                    ),
                ],
            },
        ),
        migrations.AddIndex(
            model_name="wallet",
            index=models.Index(fields=["user_account", "verification_status"], name="wallets_user_ac_11eac8_idx"),
        ),
        migrations.AddIndex(
            model_name="wallet",
            index=models.Index(fields=["chain"], name="wallets_chain_16c273_idx"),
        ),
        migrations.AddConstraint(
            model_name="wallet",
            constraint=models.UniqueConstraint(
                fields=("user_account", "chain", "address"), name="unique_wallet_network_address"
            ),
        ),
        migrations.AddConstraint(
            model_name="wallet",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("address"),
                models.F("user_account"),
                models.F("chain"),
                condition=models.Q(("chain__in", ["arbitrum", "avalanche", "base", "ethereum", "optimism", "polygon"])),
                name="unique_evm_wallet_network_address",
            ),
        ),
        migrations.AddIndex(
            model_name="holding",
            index=models.Index(fields=["wallet"], name="idx_holding_wallet"),
        ),
        migrations.AddIndex(
            model_name="holding",
            index=models.Index(fields=["asset"], name="idx_holding_asset"),
        ),
        migrations.AddConstraint(
            model_name="holding",
            constraint=models.UniqueConstraint(fields=("wallet", "asset"), name="unique_wallet_asset"),
        ),
        migrations.AddConstraint(
            model_name="bitcoinsubmission",
            constraint=models.UniqueConstraint(fields=("network", "tx_hash"), name="unique_bitcoin_submission_hash"),
        ),
        migrations.AddConstraint(
            model_name="bitcoinsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("network__in", ["test", "regtest"])), name="bitcoin_submission_network"
            ),
        ),
        migrations.AddConstraint(
            model_name="bitcoinsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("tx_hash__regex", "^[0-9a-f]{64}$")), name="bitcoin_submission_hash"
            ),
        ),
        migrations.AddConstraint(
            model_name="bitcoinsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("witness_hash__regex", "^[0-9a-f]{64}$")), name="bitcoin_submission_witness"
            ),
        ),
        migrations.AddConstraint(
            model_name="bitcoinsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("genesis_hash__regex", "^[0-9a-f]{64}$")), name="bitcoin_submission_genesis"
            ),
        ),
        migrations.AddIndex(
            model_name="transaction",
            index=models.Index(fields=["tx_hash"], name="transaction_tx_hash_630f6e_idx"),
        ),
        migrations.AddIndex(
            model_name="transaction",
            index=models.Index(fields=["from_address"], name="transaction_from_ad_b319de_idx"),
        ),
        migrations.AddIndex(
            model_name="transaction",
            index=models.Index(fields=["to_address"], name="transaction_to_addr_75c298_idx"),
        ),
        migrations.AddIndex(
            model_name="transaction",
            index=models.Index(fields=["wallet", "-block_timestamp"], name="transaction_wallet__e10127_idx"),
        ),
        migrations.AddIndex(
            model_name="transaction",
            index=models.Index(fields=["chain", "-block_timestamp"], name="transaction_chain_c40788_idx"),
        ),
        migrations.AddIndex(
            model_name="transaction",
            index=models.Index(fields=["status"], name="transaction_status_505a2f_idx"),
        ),
        migrations.AlterUniqueTogether(
            name="transaction",
            unique_together={("tx_hash", "wallet")},
        ),
        migrations.AddConstraint(
            model_name="walletchainwatch",
            constraint=models.CheckConstraint(
                condition=models.Q(("network__regex", "^(evm:[1-9][0-9]*|bitcoin:[0-9a-f]{64})$")),
                name="wallet_watch_network",
            ),
        ),
        migrations.AddConstraint(
            model_name="walletchainwatch",
            constraint=models.CheckConstraint(
                condition=models.Q(("tx_hash__regex", "^(0x)?[0-9a-f]{64}$")), name="wallet_watch_hash"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletchainwatch",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("generation", 0), ("last_started_at__isnull", True), ("target_fingerprint", "")),
                    models.Q(
                        ("generation__gt", 0),
                        ("last_started_at__isnull", False),
                        ("target_fingerprint__regex", "^[0-9a-f]{64}$"),
                    ),
                    _connector="OR",
                ),
                name="wallet_watch_claim",
            ),
        ),
        migrations.AddConstraint(
            model_name="walletchainobservation",
            constraint=models.UniqueConstraint(fields=("watch", "generation"), name="wallet_observation_generation"),
        ),
        migrations.AddConstraint(
            model_name="walletchainobservation",
            constraint=models.CheckConstraint(
                condition=models.Q(("generation__gt", 0)), name="wallet_observation_claim"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletchainobservation",
            constraint=models.CheckConstraint(
                condition=models.Q(("target_fingerprint__regex", "^[0-9a-f]{64}$")), name="wallet_observation_target"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletchainobservation",
            constraint=models.CheckConstraint(
                condition=models.Q(("result__in", ["unknown", "included", "orphaned"])),
                name="wallet_observation_result",
            ),
        ),
        migrations.AddConstraint(
            model_name="walletchainobservation",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("finality", "unknown"),
                    models.Q(("finality__in", ["waiting", "satisfied"]), ("result", "included")),
                    _connector="OR",
                ),
                name="wallet_observation_finality",
            ),
        ),
        migrations.AddIndex(
            model_name="walletpossessionproof",
            index=models.Index(fields=["wallet_id", "completed_at"], name="wallets_wal_wallet__0d3dc5_idx"),
        ),
        migrations.AddConstraint(
            model_name="walletpossessionproof",
            constraint=models.UniqueConstraint(
                fields=("wallet_id", "challenge"), name="one_wallet_proof_per_challenge"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletpossessionproof",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("completed_at__gte", models.F("challenge_issued_at")),
                    ("completed_at__lt", models.F("challenge_expires_at")),
                ),
                name="wallet_proof_challenge_lifetime",
            ),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.UniqueConstraint(fields=("wallet", "tx_hash"), name="unique_wallet_submission_hash"),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.UniqueConstraint(
                fields=("wallet", "chain_id", "nonce"), name="unique_wallet_submission_nonce"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.UniqueConstraint(fields=("chain_id", "tx_hash"), name="unique_submission_chain_hash"),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.UniqueConstraint(
                fields=("chain_id", "sender_address", "nonce"), name="unique_submission_sender_nonce"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("chain_id__gt", 0)), name="wallet_submission_chain_id"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("tx_hash__regex", "^0x[0-9a-f]{64}$")), name="wallet_submission_hash"
            ),
        ),
        migrations.AddConstraint(
            model_name="walletsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("sender_address__regex", "^0x[0-9a-f]{40}$")), name="wallet_submission_sender"
            ),
        ),
    ]
