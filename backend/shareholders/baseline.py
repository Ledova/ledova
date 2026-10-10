from pathlib import Path

from django.conf import settings

SQL = Path(__file__).with_suffix(".sql").read_text()


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        cursor.execute(SQL.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate).replace("__APP__", app))
