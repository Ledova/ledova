from django.db import migrations

import tokens.database_transfer_guards


class Migration(migrations.Migration):
    dependencies = [("shared", "0004_register_mirror_guards")]

    operations = [migrations.RunPython(tokens.database_transfer_guards.install)]
