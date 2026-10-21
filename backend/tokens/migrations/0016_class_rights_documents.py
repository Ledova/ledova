from django.db import migrations, models

import tokens.database_class_documents


class Migration(migrations.Migration):

    dependencies = [("tokens", "0015_optional_mirror_allotment_history")]

    operations = [
        migrations.AddField(
            model_name="classrightsrevision",
            name="documents",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AlterField(
            model_name="registerevidence",
            name="kind",
            field=models.CharField(
                choices=[
                    ("share_register", "Share register"),
                    ("asic_extract", "ASIC extract"),
                    ("authority", "Authority document"),
                    ("supporting", "Supporting document"),
                    ("class_rights", "Class document"),
                ],
                max_length=16,
            ),
        ),
        migrations.RunPython(tokens.database_class_documents.install, reverse_code=migrations.RunPython.noop),
    ]
