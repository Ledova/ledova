from django.db import migrations, models

import tokens.database_class_documents


class Migration(migrations.Migration):
    dependencies = [("tokens", "0017_structured_class_rights")]

    operations = [
        migrations.AlterField(
            model_name="classrightsrevision",
            name="summary",
            field=models.CharField(blank=True, max_length=20000),
        ),
        migrations.RunPython(tokens.database_class_documents.install, reverse_code=migrations.RunPython.noop),
    ]
