from importlib import import_module

from django.db import migrations

original = import_module("shared.migrations.0008_scoped_role_table_grants").Migration


class Migration(migrations.Migration):
    replaces = [("shared", "0008_scoped_role_table_grants")]

    dependencies = [
        *original.dependencies,
        ("procrastinate", "0041_post_retry_failed_job"),
    ]

    operations = original.operations
