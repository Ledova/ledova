from django.db import migrations

from shared.db.policy_sql import install


def reinstall(apps, schema_editor):
    install(schema_editor)


class Migration(migrations.Migration):
    dependencies = [("shared", "0011_the_helper_names_the_principal")]

    operations = [migrations.RunPython(reinstall, migrations.RunPython.noop)]
