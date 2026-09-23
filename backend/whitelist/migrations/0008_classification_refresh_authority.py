from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("whitelist", "0007_per_company_approvals"),
    ]

    operations = [
        migrations.AlterField(
            model_name="whitelistchange",
            name="authority",
            field=models.CharField(
                choices=[
                    ("operator_api", "Operator API"),
                    ("whitelist_admin", "Whitelist administration"),
                    ("subscription_admin", "Subscription administration"),
                    ("refresh", "Classification refresh"),
                ],
                editable=False,
                max_length=20,
            ),
        ),
        migrations.RemoveConstraint(
            model_name="whitelistchange",
            name="whitelist_change_authority",
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("authority__in", ["operator_api", "whitelist_admin", "subscription_admin", "refresh"])
                ),
                name="whitelist_change_authority",
            ),
        ),
    ]
