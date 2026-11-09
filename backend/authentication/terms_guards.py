from pathlib import Path

from django.conf import settings


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_ident(%s), quote_ident(%s)",
            [
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["migrate"],
                settings.RLS_ROLES["app"],
                settings.RLS_ROLES["operator"],
            ],
        )
        operator_literal, migrate_literal, app, operator = cursor.fetchone()
        cursor.execute(
            Path(__file__)
            .with_suffix(".sql")
            .read_text()
            .replace("@OPERATOR_ROLE@", operator_literal)
            .replace("@MIGRATE_ROLE@", migrate_literal)
        )
        cursor.execute("ALTER TABLE authentication_termsacceptance ENABLE ROW LEVEL SECURITY")
        cursor.execute("ALTER TABLE authentication_termsacceptance FORCE ROW LEVEL SECURITY")
        cursor.execute(f"REVOKE ALL ON authentication_termsacceptance FROM {app}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON authentication_termsacceptance TO {operator}")
