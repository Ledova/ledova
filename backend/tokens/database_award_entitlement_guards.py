from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_name("database_award_guards.sql").read_text()
    names = (
        "tokens_employee_award_reversed",
        "tokens_employee_award_ended",
        "tokens_employee_award_latest_on",
        "tokens_employee_award_adjustments",
        "tokens_employee_award_adjusted_at",
        "tokens_register_grant_approved",
        "tokens_employee_award_vested_on",
        "tokens_employee_award_vested",
        "tokens_guard_employee_award_vesting",
        "tokens_employee_award_grant_matches",
        "tokens_check_employee_award_allocation",
        "tokens_guard_employee_award_adjustment",
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        for name in names:
            cursor.execute(_function(source, name).replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))
        for filename in ("database_award_guards.sql", "database_allotment_guards.sql"):
            digest_source = Path(__file__).with_name(filename).read_text()
            cursor.execute(_function(digest_source, "tokens_register_grant_decision_digest"))
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app, operator = cursor.fetchone()
        for table in ("tokens_registerawardend", "tokens_registerawardvestingreversal"):
            cursor.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            cursor.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            cursor.execute(f"REVOKE ALL ON {table} FROM {app}")
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {operator}")
            cursor.execute(
                f"CREATE TRIGGER {table}_identity BEFORE INSERT OR UPDATE OR DELETE ON {table} "
                "FOR EACH ROW EXECUTE FUNCTION tokens_guard_employee_award_adjustment()"
            )
            cursor.execute(
                f"CREATE CONSTRAINT TRIGGER {table}_commit_authority AFTER INSERT ON {table} "
                "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_employee_award_authority()"
            )
