from pathlib import Path

from django.db import migrations

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = (Path(__file__).resolve().parents[1] / "database_class_lifecycle.sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        for name in ("tokens_class_deletion_reason", "tokens_class_details_available"):
            cursor.execute(_function(source, name))


class Migration(migrations.Migration):
    dependencies = [("tokens", "0013_import_member_choice")]

    operations = [migrations.RunPython(install, migrations.RunPython.noop)]
