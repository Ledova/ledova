from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_suffix(".sql").read_text()
    particulars = Path(__file__).with_name("database_allotment_guards.sql").read_text()
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
        for name in (
            "tokens_guard_register_member_particulars",
            "tokens_register_particulars_snapshot",
            "tokens_register_allotment_decision_digest",
            "tokens_register_grant_decision_digest",
        ):
            cursor.execute(
                _function(particulars, name).replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate)
            )
        cursor.execute("ALTER TABLE tokens_registerpersonregistration ENABLE ROW LEVEL SECURITY")
        cursor.execute("ALTER TABLE tokens_registerpersonregistration FORCE ROW LEVEL SECURITY")
        cursor.execute(f"REVOKE ALL ON tokens_registerpersonregistration FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_registerpersonregistration TO {operator_role}")
