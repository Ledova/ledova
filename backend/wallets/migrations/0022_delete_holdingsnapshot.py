from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("wallets", "0021_transaction_finality_observation")]

    operations = [migrations.DeleteModel(name="HoldingSnapshot")]
