from importlib import import_module

from django.db import migrations

OLD_CLAUSE = "        OR invitation.uuid IS NULL OR invitation.company_id IS DISTINCT FROM candidate.company_id\n"
NEW_CLAUSE = OLD_CLAUSE + """        OR candidate.appointee_id IS NOT DISTINCT FROM invitation.inviter_id
        OR EXISTS (
            SELECT 1 FROM companies_companyappointment retained
            WHERE retained.company_id = candidate.company_id AND retained.appointee_id = candidate.appointee_id
              AND (retained.expires_at IS NULL OR retained.expires_at > clock_timestamp())
              AND NOT EXISTS (
                  SELECT 1 FROM companies_companyappointmentrevocation revoked
                  WHERE revoked.appointment_id = retained.uuid))
"""


def replace_guard(schema_editor, old, new):
    replace_once = import_module("companies.migrations.0017_company_team_invitations").replace_once
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_companyappointment IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT pg_get_functiondef('companies_validate_invited_appointment'::regproc)")
        cursor.execute(replace_once(cursor.fetchone()[0], old, new))


def install_guard(apps, schema_editor):
    replace_guard(schema_editor, OLD_CLAUSE, NEW_CLAUSE)


def remove_guard(apps, schema_editor):
    replace_guard(schema_editor, NEW_CLAUSE, OLD_CLAUSE)


class Migration(migrations.Migration):

    dependencies = [("companies", "0017_company_team_invitations")]

    operations = [migrations.RunPython(install_guard, remove_guard)]
