from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0009_verify_supported_assets_cleanup_spam"),
        ("wallets", "0021_transaction_finality_observation"),
    ]

    operations = [migrations.DeleteModel(name="HoldingSnapshot")]
