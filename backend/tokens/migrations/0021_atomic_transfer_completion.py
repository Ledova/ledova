import django.db.models.deletion
from django.db import migrations, models

import tokens.database_transfer_completion


class Migration(migrations.Migration):
    dependencies = [("tokens", "0020_company_people")]

    operations = [
        migrations.AddField(
            model_name="registertransferdecision",
            name="completion_approval_appointment",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.RunPython(tokens.database_transfer_completion.install, reverse_code=migrations.RunPython.noop),
    ]
