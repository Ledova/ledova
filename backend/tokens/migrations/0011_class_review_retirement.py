from django.db import migrations

from tokens.database_class_lifecycle import install


class Migration(migrations.Migration):
    dependencies = [("tokens", "0010_empty_opening_deletion")]

    operations = [migrations.RunPython(install, migrations.RunPython.noop)]
