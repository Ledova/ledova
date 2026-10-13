from pathlib import Path

from django.conf import settings


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["app"]])
        app = cursor.fetchone()[0]
        cursor.execute(Path(__file__).with_suffix(".sql").read_text().replace("@APP_ROLE@", app))
