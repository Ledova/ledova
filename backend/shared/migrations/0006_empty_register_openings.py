from django.db import migrations

import tokens.database_mirror_guards


class Migration(migrations.Migration):
    dependencies = [("shared", "0005_register_transfer_class_guards")]

    operations = [migrations.RunPython(tokens.database_mirror_guards.install)]
