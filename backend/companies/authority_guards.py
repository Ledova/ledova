from pathlib import Path

from django.conf import settings

SQL = Path(__file__).with_suffix(".sql").read_text()


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["app"], settings.RLS_ROLES["migrate"]],
        )
        app, migrate = cursor.fetchone()
        cursor.execute(SQL.replace("@APP_ROLE@", app).replace("@MIGRATE_ROLE@", migrate))
