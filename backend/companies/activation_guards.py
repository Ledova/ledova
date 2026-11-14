from pathlib import Path

from django.conf import settings

TABLE = "companies_companyactivation"
SQL = Path(__file__).with_suffix(".sql").read_text()


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [TABLE])
        if not cursor.fetchone()[0]:
            return
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        cursor.execute(SQL.replace("@OPERATOR_ROLE@", operator).replace("@MIGRATE_ROLE@", migrate))
        cursor.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
        cursor.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app, operator = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON {TABLE} FROM {app}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO {operator}")
