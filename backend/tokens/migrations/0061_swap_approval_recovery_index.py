from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0060_order_submission_settlement_chain_refusal"),
    ]

    operations = [
        migrations.AlterField(
            model_name="swapapprovalsubmission",
            name="last_attempt_at",
            field=models.DateTimeField(editable=False, null=True),
        ),
        migrations.AddIndex(
            model_name="swapapprovalsubmission",
            index=models.Index(
                condition=models.Q(("outcome", "pending")),
                fields=["updated_at", "created_at", "uuid"],
                name="pending_swap_approval_recovery",
            ),
        ),
    ]
