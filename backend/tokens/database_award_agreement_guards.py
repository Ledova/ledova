from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_name("database_award_guards.sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for name in ("tokens_register_grant_terms_evidence_matches", "tokens_guard_register_grant"):
            statement = _function(source, name)
            cursor.execute(
                statement.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate).replace("__APP__", app)
            )
