from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    sources = {
        "database_guards.sql": (
            "tokens_register_company_date_ready",
            "tokens_register_company_event_on",
            "tokens_register_transition_on",
            "tokens_project_register_entry",
            "tokens_register_transfer_ready",
            "tokens_register_transfer_decision_digest",
            "tokens_guard_register_transfer",
            "tokens_guard_transfer_register_entry",
        ),
        "database_award_guards.sql": (
            "tokens_employee_award_reversed",
            "tokens_employee_award_ended",
            "tokens_employee_award_latest_on",
            "tokens_employee_award_adjustments",
            "tokens_employee_award_vested_on",
            "tokens_employee_award_grant_matches",
            "tokens_register_grant_ready",
            "tokens_guard_register_grant",
        ),
        "database_allotment_guards.sql": (
            "tokens_register_allotment_ready",
            "tokens_register_allotment_decision_digest",
            "tokens_guard_register_allotment",
            "tokens_guard_allotment_register_entry",
            "tokens_guard_grant_register_entry",
            "tokens_register_grant_decision_digest",
        ),
    }
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for filename, names in sources.items():
            source = Path(__file__).with_name(filename).read_text()
            for name in names:
                statement = _function(source, name)
                cursor.execute(
                    statement.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate).replace("__APP__", app)
                )
