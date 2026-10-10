import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("portfolios", "0001_initial"),
        ("portfolios", "0002_initial"),
        ("portfolios", "0003_remove_portfolio_template_and_target_asset_allocation"),
        ("portfolios", "0004_delete_assetallocation"),
        ("portfolios", "0005_delete_portfoliosnapshot"),
    ]

    initial = True

    dependencies = [
        ("users", "0001_baseline"),
        ("wallets", "0001_baseline"),
    ]

    operations = [
        migrations.CreateModel(
            name="Portfolio",
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
                ("is_active", models.BooleanField(default=True)),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="portfolios", to="users.useraccount"
                    ),
                ),
                ("wallets", models.ManyToManyField(blank=True, related_name="portfolios", to="wallets.wallet")),
            ],
            options={
                "verbose_name": "Portfolio",
                "verbose_name_plural": "Portfolios",
                "db_table": "portfolios",
                "ordering": ["-created_at"],
            },
        ),
    ]
