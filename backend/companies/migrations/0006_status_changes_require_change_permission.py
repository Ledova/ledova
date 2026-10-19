from django.db import migrations

import companies.database_workflow_guards


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0005_initial_admission_without_registry_lookup"),
    ]

    operations = [
        migrations.RunPython(companies.database_workflow_guards.install),
    ]
