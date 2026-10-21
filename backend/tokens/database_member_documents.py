from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import install_member_validation


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    install_member_validation(apps, schema_editor)
    source = Path(__file__).with_suffix(".sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_ident(%s), quote_ident(%s)",
            [
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["migrate"],
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["app"],
            ],
        )
        operator, migrate, operator_role, app_role = cursor.fetchone()
        cursor.execute(source.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))
        cursor.execute("ALTER TABLE tokens_registermemberdocument ENABLE ROW LEVEL SECURITY")
        cursor.execute("ALTER TABLE tokens_registermemberdocument FORCE ROW LEVEL SECURITY")
        cursor.execute(f"REVOKE ALL ON tokens_registermemberdocument FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_registermemberdocument TO {operator_role}")
