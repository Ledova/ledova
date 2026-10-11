import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("portfolios", "0001_initial"),
        ("users", "0001_initial"),
        ("wallets", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="portfolio",
            name="user_account",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="portfolios", to="users.useraccount"
            ),
        ),
        migrations.AddField(
            model_name="portfolio",
            name="wallets",
            field=models.ManyToManyField(blank=True, related_name="portfolios", to="wallets.wallet"),
        ),
    ]
