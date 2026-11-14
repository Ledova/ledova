from django.conf import settings
from django.db import migrations

from companies import activation_guards, database_guards
from tokens.database_mirror_guards import _function

REPLACED = (
    (database_guards.SQL, "companies_guard_administration"),
    (activation_guards.SQL, "companies_guard_activation"),
)

REMOVED = (
    "DROP TRIGGER IF EXISTS companies_activation_effect ON companies_companyactivation",
    "DROP FUNCTION IF EXISTS companies_guard_activation_effect()",
    "DROP FUNCTION IF EXISTS companies_current_activation_source(companies_companyactivation)",
)

ACTIVATE_ADMITTED = """
    UPDATE companies_company company
    SET status = 'active', activated_at = admission.admitted_at, updated_at = clock_timestamp()
    FROM (
        SELECT appointment.company_id, MIN(appointment.created_at) AS admitted_at
        FROM companies_companyappointment appointment
        WHERE appointment.request_id IS NOT NULL OR appointment.legacy_owner_id IS NOT NULL
        GROUP BY appointment.company_id
    ) admission
    WHERE company.uuid = admission.company_id AND company.activated_at IS NULL
        AND company.status IN ('draft', 'submitted', 'review', 'info_required', 'approved', 'rejected', 'withdrawn')
"""


def activate_at_signup(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for source, name in REPLACED:
            cursor.execute(
                _function(source, name)
                .replace("@OPERATOR_ROLE@", operator)
                .replace("@MIGRATE_ROLE@", migrate)
                .replace("@APP_ROLE@", app)
            )
        for statement in REMOVED:
            cursor.execute(statement)
        cursor.execute(ACTIVATE_ADMITTED)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0006_company_disposal"),
    ]

    operations = [
        migrations.RunPython(activate_at_signup, migrations.RunPython.noop),
    ]
