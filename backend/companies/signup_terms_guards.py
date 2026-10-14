from pathlib import Path

from django.conf import settings


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        cursor.execute(
            Path(__file__)
            .with_suffix(".sql")
            .read_text()
            .replace("@OPERATOR_ROLE@", operator)
            .replace("@MIGRATE_ROLE@", migrate)
        )
        cursor.execute("ALTER TABLE companies_companysignuptermsacceptance ENABLE ROW LEVEL SECURITY")
        cursor.execute("ALTER TABLE companies_companysignuptermsacceptance FORCE ROW LEVEL SECURITY")
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app, operator = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON companies_companysignuptermsacceptance FROM {app}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON companies_companysignuptermsacceptance TO {operator}")
