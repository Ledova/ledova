from django.db import migrations

import tokens.database_mirror_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0006_empty_register_openings"),
        ("tokens", "0007_register_mirror_setup"),
    ]

    operations = [migrations.RunPython(tokens.database_mirror_guards.install)]
