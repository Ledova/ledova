from django.conf import settings
from django.db import migrations

from tokens.database_mirror_guards import SQL, _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        for name in ("tokens_mirror_members_valid", "tokens_validate_mirror_import"):
            cursor.execute(_function(SQL, name).replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))


class Migration(migrations.Migration):
    dependencies = [("tokens", "0012_class_details_history")]

    operations = [migrations.RunPython(install, migrations.RunPython.noop)]
