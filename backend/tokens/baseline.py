from pathlib import Path

from django.conf import settings

SQL = Path(__file__).with_suffix(".sql").read_text()
RESTRICTED_TABLES = (
    "tokens_tokendeployment",
    "tokens_capitalincreaseexecution",
    "tokens_shareissuanceexecution",
    "tokens_pausechange",
    "tokens_registerdeployment",
    "tokens_registerdeploymentdecision",
    "tokens_registerinstructiondecision",
    "tokens_registercapitalincrease",
    "tokens_registercapitalincreasedecision",
    "tokens_registerpausechange",
    "tokens_registerpausechangedecision",
    "tokens_stablecoin_fold_grant",
)


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
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        for table in RESTRICTED_TABLES:
            cursor.execute(f"REVOKE ALL ON {table} FROM {app_role}")
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {operator_role}")
