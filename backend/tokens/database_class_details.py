from pathlib import Path

from django.conf import settings

from tokens.database_class_lifecycle import install as install_lifecycle


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.tokens_classdetailsrevision') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return
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
        source = Path(__file__).with_suffix(".sql").read_text()
        cursor.execute(source.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))
        cursor.execute("ALTER TABLE tokens_classdetailsrevision ENABLE ROW LEVEL SECURITY")
        cursor.execute("ALTER TABLE tokens_classdetailsrevision FORCE ROW LEVEL SECURITY")
        cursor.execute(f"REVOKE ALL ON tokens_classdetailsrevision FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_classdetailsrevision TO {operator_role}")
    install_lifecycle(apps, schema_editor)
