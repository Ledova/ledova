import django.db.models.deletion
from django.db import migrations, models


def retain_settlement_evidence(apps, schema_editor):
    transaction = apps.get_model("wallets", "Transaction")
    if transaction.objects.using(schema_editor.connection.alias).filter(finality_observation__isnull=False).exists():
        raise RuntimeError("Retain the finality observation that authorized wallet settlement.")


class Migration(migrations.Migration):
    dependencies = [("wallets", "0020_transaction_monitoring_completed_at")]

    operations = [
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
        migrations.RunPython(migrations.RunPython.noop, retain_settlement_evidence),
    ]
