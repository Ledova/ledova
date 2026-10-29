import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("users", "0001_initial"),
        ("wallets", "0001_initial"),
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
