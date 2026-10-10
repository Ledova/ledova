import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("assets", "0001_initial"),
        ("assets", "0002_add_ledova_aaud_asset"),
        ("assets", "0003_rename_aaud_asset"),
        ("assets", "0004_deactivate_unsupported_assets"),
        ("assets", "0005_add_asset_chain_deployment"),
        ("assets", "0006_populate_chain_deployments"),
        ("assets", "0007_remove_asset_chain_contract"),
        ("assets", "0008_asset_is_verified"),
        ("assets", "0009_verify_supported_assets_cleanup_spam"),
        ("assets", "0010_alter_asset_asset_type_alter_asset_current_price_and_more"),
        ("assets", "0011_add_exchange_rate_model"),
        ("assets", "0012_audy_base_deployment"),
        ("assets", "0013_price_provenance"),
        ("assets", "0014_native_chain_deployments"),
    ]

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Asset",
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
                ("symbol", models.CharField(db_index=True, max_length=32, unique=True)),
                ("name", models.CharField(max_length=255)),
                (
                    "asset_type",
                    models.CharField(
                        choices=[
                            ("native_crypto", "Native Crypto"),
                            ("erc20_token", "Erc20 Token"),
                            ("stablecoin", "Stablecoin"),
                            ("tokenized_security", "Tokenized Security"),
                            ("tokenized_rwa", "Tokenized Rwa"),
                            ("synthetic", "Synthetic"),
                        ],
                        max_length=32,
                    ),
                ),
                ("decimals", models.IntegerField(default=18)),
                ("current_price", models.DecimalField(blank=True, decimal_places=18, max_digits=40, null=True)),
                ("price_currency", models.CharField(default="USD", max_length=16)),
                (
                    "price_source",
                    models.CharField(
                        choices=[("market", "Market price"), ("nav", "NAV"), ("par", "Par")],
                        default="market",
                        max_length=12,
                        null=True,
                    ),
                ),
                ("is_active", models.BooleanField(default=True)),
                ("is_verified", models.BooleanField(default=False)),
            ],
            options={
                "verbose_name": "Asset",
                "verbose_name_plural": "Assets",
                "ordering": ["symbol"],
                "indexes": [
                    models.Index(fields=["symbol"], name="idx_asset_symbol"),
                    models.Index(fields=["asset_type"], name="idx_asset_type"),
                ],
            },
        ),
        migrations.CreateModel(
            name="ExchangeRate",
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
                ("base_currency", models.CharField(default="USD", max_length=8)),
                ("target_currency", models.CharField(max_length=8)),
                ("rate", models.DecimalField(decimal_places=10, max_digits=20)),
            ],
            options={
                "indexes": [models.Index(fields=["base_currency", "target_currency"], name="idx_exchange_rate_pair")],
                "unique_together": {("base_currency", "target_currency")},
            },
        ),
        migrations.CreateModel(
            name="AssetChainDeployment",
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
                ("chain", models.CharField(help_text="Blockchain (ethereum, base, bitcoin, etc.)", max_length=32)),
                (
                    "contract_address",
                    models.CharField(
                        blank=True,
                        help_text="Contract address on this chain (null for native assets like ETH, BTC)",
                        max_length=128,
                        null=True,
                    ),
                ),
                ("decimals", models.IntegerField(default=18, help_text="Token decimals on this chain")),
                ("is_active", models.BooleanField(default=True)),
                (
                    "asset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="chain_deployments", to="assets.asset"
                    ),
                ),
            ],
            options={
                "verbose_name": "Asset Chain Deployment",
                "verbose_name_plural": "Asset Chain Deployments",
                "db_table": "asset_chain_deployments",
                "ordering": ["asset", "chain"],
                "indexes": [models.Index(fields=["chain", "contract_address"], name="idx_deploy_chain_contract")],
                "constraints": [
                    models.UniqueConstraint(fields=("asset", "chain"), name="unique_asset_chain"),
                    models.UniqueConstraint(
                        condition=models.Q(("contract_address__isnull", False)),
                        fields=("chain", "contract_address"),
                        name="unique_chain_contract",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="AssetSnapshot",
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
                ("price", models.DecimalField(decimal_places=18, help_text="Price at snapshot time", max_digits=40)),
                ("price_currency", models.CharField(default="USD", help_text="Currency of price", max_length=16)),
                (
                    "market_data",
                    models.JSONField(
                        blank=True, default=dict, help_text="Additional market data (volume, market cap, etc.)"
                    ),
                ),
                ("source_timestamp", models.DateTimeField(help_text="When this data was captured")),
                (
                    "data_source",
                    models.CharField(
                        help_text="Source identifier (e.g., 'manual', 'provider_api', 'chainlink_oracle')",
                        max_length=64,
                    ),
                ),
                (
                    "block_number",
                    models.BigIntegerField(
                        blank=True, help_text="Blockchain block number (if from on-chain source)", null=True
                    ),
                ),
                (
                    "tx_hash",
                    models.CharField(
                        blank=True, help_text="Transaction hash (if from on-chain source)", max_length=128, null=True
                    ),
                ),
                (
                    "asset",
                    models.ForeignKey(
                        help_text="Asset this snapshot belongs to",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="snapshots",
                        to="assets.asset",
                    ),
                ),
            ],
            options={
                "verbose_name": "Asset Snapshot",
                "verbose_name_plural": "Asset Snapshots",
                "db_table": "asset_snapshots",
                "ordering": ["-source_timestamp"],
                "indexes": [
                    models.Index(fields=["asset", "-source_timestamp"], name="idx_snap_asset_time"),
                    models.Index(fields=["source_timestamp"], name="idx_snap_time"),
                ],
                "constraints": [
                    models.UniqueConstraint(fields=("asset", "source_timestamp"), name="unique_asset_snapshot")
                ],
            },
        ),
    ]
