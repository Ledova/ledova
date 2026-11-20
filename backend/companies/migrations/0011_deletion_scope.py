from django.db import migrations, models

from companies.disposal_guards import install


class Migration(migrations.Migration):
    dependencies = [("companies", "0010_company_delete")]

    operations = [
        migrations.AddField(
            model_name="companydisposal",
            name="scope",
            field=models.CharField(
                choices=[("company", "Company"), ("share_class", "Share class")], default="company", max_length=20
            ),
        ),
        migrations.AlterField(
            model_name="companydisposal",
            name="company_id",
            field=models.UUIDField(),
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
