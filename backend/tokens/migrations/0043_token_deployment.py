import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("tokens", "0042_mint_request_operations"),
    ]

    operations = [
        migrations.AddField(
            model_name="sharetoken",
            name="deployment_id",
            field=models.UUIDField(editable=False, null=True),
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
    ]
