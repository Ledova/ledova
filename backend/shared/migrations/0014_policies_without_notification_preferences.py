from django.db import migrations

from shared.db.policy_sql import install


def reinstall(apps, schema_editor):
    install(schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0013_policies_without_the_dropped_tables"),
        ("users", "0027_transaction_alerts_on_user_preferences"),
    ]

    operations = [migrations.RunPython(reinstall, migrations.RunPython.noop)]
