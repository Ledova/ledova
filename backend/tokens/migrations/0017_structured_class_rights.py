from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tokens", "0016_class_rights_documents")]

    operations = [
        migrations.AddField(
            model_name="classrightsrevision",
            name="attributes",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="classrightsrevision",
            name="effective_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
