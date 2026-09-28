from django.db import migrations

from shared.db.policy_sql import install


def reinstall(apps, schema_editor):
    install(schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0012_operator_creates_matches"),
        ("users", "0026_delete_favouriteasset"),
        ("wallets", "0022_delete_holdingsnapshot"),
    ]

    operations = [migrations.RunPython(reinstall, migrations.RunPython.noop)]
