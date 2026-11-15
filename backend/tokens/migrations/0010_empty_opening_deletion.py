from django.db import migrations

from tokens.database_class_lifecycle import install


class Migration(migrations.Migration):
    dependencies = [("tokens", "0009_class_deletion_history")]

    operations = [migrations.RunPython(install, migrations.RunPython.noop)]
