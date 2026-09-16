import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("blockchain", "0006_signer_admission")]

    operations = [
        migrations.AddField(
            model_name="blockchaintransaction",
            name="outgoing_operation",
            field=models.OneToOneField(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="swap_transaction",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddConstraint(
            model_name="blockchaintransaction",
            constraint=models.UniqueConstraint(
                fields=("related_uuid",),
                condition=models.Q(tx_type="atomic_swap", function_args__has_key="admission"),
                name="unique_admitted_swap_transaction",
            ),
        ),
    ]
