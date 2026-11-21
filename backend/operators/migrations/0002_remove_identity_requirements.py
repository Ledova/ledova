from pathlib import Path

from django.conf import settings
from django.db import migrations

from shared.db.policy_sql import install as install_policies
from tokens.database_mirror_guards import _function

BACKEND = Path(__file__).resolve().parents[2]
REPLACED = (
    ("companies/database_guards.sql", "companies_current_team_appointment"),
    ("companies/database_guards.sql", "companies_validate_invited_appointment"),
    ("companies/database_guards.sql", "companies_locked_administration"),
    ("companies/authority_guards.sql", "companies_guard_initial_appointment"),
    ("companies/signup_terms_guards.sql", "companies_guard_signup_terms_acceptance"),
    ("tokens/database_guards.sql", "tokens_register_appointment_current"),
    ("users/database_guards.sql", "users_participant_current"),
    ("whitelist/database_guards.sql", "whitelist_check_wallet_invalidation"),
    ("whitelist/database_guards.sql", "whitelist_eligibility_invalidation_facts"),
    ("whitelist/database_guards.sql", "whitelist_guard_eligibility_invalidation"),
)


def stop_reading_identity_requirements(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        cursor.execute("DROP TRIGGER IF EXISTS operators_issuer_identity_policy ON operators_operator")
        cursor.execute("DROP FUNCTION IF EXISTS operators_guard_issuer_identity_policy()")
        for path, name in REPLACED:
            cursor.execute(
                _function((BACKEND / path).read_text(), name)
                .replace("@OPERATOR_ROLE@", operator)
                .replace("@MIGRATE_ROLE@", migrate)
                .replace("@APP_ROLE@", app)
                .replace("__OPERATOR__", operator)
                .replace("__MIGRATE__", migrate)
                .replace("__APP__", app)
            )
    install_policies(schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("operators", "0001_initial"),
        ("companies", "0017_remove_identity_requirement"),
        ("tokens", "0016_remove_corrections"),
        ("users", "0005_remove_eligibility_answers"),
        ("whitelist", "0003_remove_identity_loss"),
    ]

    operations = [
        migrations.RunPython(stop_reading_identity_requirements, migrations.RunPython.noop),
        migrations.RemoveField(model_name="operator", name="investor_kyc_required"),
        migrations.RemoveField(model_name="operator", name="issuer_kyc_required"),
    ]
