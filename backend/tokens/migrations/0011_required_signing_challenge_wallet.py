import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tokens", "0010_company_acknowledgements")]

    operations = [
        migrations.AlterField(
            model_name="signingchallenge",
            name="wallet",
            field=models.ForeignKey(
                help_text="Owner. Supplied by the service, which holds the authenticated caller's wallet.",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="wallets.wallet",
            ),
        ),
    ]
