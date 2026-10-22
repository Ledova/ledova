import django.db.models.deletion
from django.db import migrations, models

import tokens.database_allotment_completion


class Migration(migrations.Migration):
    dependencies = [("tokens", "0018_class_rights_additional_terms")]

    operations = [
        migrations.AddField(
            model_name="registerallotmentdecision",
            name="completion_approval_appointment",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.RunPython(tokens.database_allotment_completion.install, reverse_code=migrations.RunPython.noop),
    ]
