import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("tokens", "0048_issuance_execution_guards"),
    ]

    operations = [
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_intent",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_observation",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_operation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="swap_approval",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_outcome",
            field=models.CharField(
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
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_retry_of",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_transaction",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="swap_approvals",
                to="blockchain.blockchaintransaction",
            ),
        ),
    ]
