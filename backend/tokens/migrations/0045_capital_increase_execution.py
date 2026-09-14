import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("tokens", "0044_token_deployment_guards"),
    ]

    operations = [
        migrations.AddField(
            model_name="capitalincreaserequest",
            name="dispatch_id",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="capitalincreaserequest",
            name="dispatch_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="capitalincreaserequest",
            name="additional_shares",
            field=models.PositiveIntegerField(
                help_text="Number of additional shares to authorize; execution does not mint shares"
            ),
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
    ]
