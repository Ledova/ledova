from pathlib import Path

from django.conf import settings

from companies.authority_guards import install as install_authority

SQL = Path(__file__).with_suffix(".sql").read_text()


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    install_authority(apps, schema_editor)
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        cursor.execute(
            SQL.replace("@OPERATOR_ROLE@", operator).replace("@MIGRATE_ROLE@", migrate).replace("@APP_ROLE@", app)
        )
