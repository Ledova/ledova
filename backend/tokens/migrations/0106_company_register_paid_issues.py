import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("offerings", "0010_company_eligibility_admission"),
        ("tokens", "0105_company_register_pause_guards"),
    ]

    operations = [
        migrations.AddField(
            model_name="registerinstruction",
            name="paid_subscription",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="offerings.subscription"
            ),
        ),
    ]
