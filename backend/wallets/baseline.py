from pathlib import Path

from django.conf import settings


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(current_user), quote_ident(%s), quote_ident(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]],
        )
        operator, migrate, app_identifier, operator_identifier = cursor.fetchone()
        cursor.execute(
            Path(__file__)
            .with_suffix(".sql")
            .read_text()
            .replace("@OPERATOR_ROLE@", operator)
            .replace("@MIGRATE_ROLE@", migrate)
            .replace("@APP_IDENTIFIER@", app_identifier)
            .replace("@OPERATOR_IDENTIFIER@", operator_identifier)
            .replace("@CHALLENGE_MINUTES@", str(settings.WALLET_VERIFICATION_CHALLENGE_MINUTES))
        )
