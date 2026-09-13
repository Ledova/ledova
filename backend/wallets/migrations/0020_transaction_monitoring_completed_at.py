from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("wallets", "0019_chain_observations")]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="monitoring_completed_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
