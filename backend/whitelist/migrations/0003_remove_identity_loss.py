from django.db import migrations, models

CAUSES = [("standing_loss", "Account standing lost"), ("wallet_removal", "Wallet removed or verification lost")]


class Migration(migrations.Migration):

    dependencies = [("whitelist", "0002_remove_wallet_eligibility")]

    operations = [
        migrations.RemoveConstraint(
            model_name="whitelisteligibilityinvalidation", name="whitelist_invalidation_retained_cause"
        ),
        migrations.AlterField(
            model_name="whitelistchange",
            name="invalidation_cause",
            field=models.CharField(blank=True, choices=CAUSES, editable=False, max_length=32),
        ),
        migrations.AlterField(
            model_name="whitelisteligibilityinvalidation",
            name="cause",
            field=models.CharField(choices=CAUSES, editable=False, max_length=32),
        ),
        migrations.AddConstraint(
            model_name="whitelisteligibilityinvalidation",
            constraint=models.CheckConstraint(
                condition=models.Q(cause__in=["standing_loss", "wallet_removal"]),
                name="whitelist_invalidation_retained_cause",
            ),
        ),
    ]
