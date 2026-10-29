from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function

FUNCTIONS = (
    "users_company_eligibility_summary",
    "users_guard_company_eligibility",
    "users_company_eligibility_decision_facts_current",
)


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_name("database_guards.sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        for name in FUNCTIONS:
            cursor.execute(
                _function(source, name).replace("@OPERATOR_ROLE@", operator).replace("@MIGRATE_ROLE@", migrate)
            )
