from django.db import migrations

import users.database_shared_name_guards


class Migration(migrations.Migration):

    dependencies = [
        ("shared", "0002_database_guards"),
        ("users", "0001_initial"),
    ]

    operations = [migrations.RunPython(users.database_shared_name_guards.install, migrations.RunPython.noop)]
