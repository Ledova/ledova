import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("tokens", "0046_capital_execution_guards"),
    ]

    operations = [
        migrations.AddField(
            model_name="shareissuancerequest",
            name="dispatch_id",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="shareissuancerequest",
            name="dispatch_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, null=True),
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
                ("retry_of", models.UUIDField(editable=False, null=True)),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="share_issuance",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="issuance_executions",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
    ]
