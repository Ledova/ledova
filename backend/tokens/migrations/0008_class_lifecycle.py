from django.db import migrations

from tokens.database_class_lifecycle import install


class Migration(migrations.Migration):
    dependencies = [
        ("tokens", "0007_register_follows_profile"),
        ("companies", "0009_remove_retired_review"),
    ]

    operations = [migrations.RunPython(install, migrations.RunPython.noop)]
