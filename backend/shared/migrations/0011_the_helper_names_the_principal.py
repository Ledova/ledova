from django.db import migrations

from shared.db.policies import PRINCIPAL_ACCOUNTS
from shared.db.policy_sql import install

RETIRED = "app_member_account_ids"
CURRENT_PARTY = "tokens_swap_has_current_party"
DEFINITION = (
    "SELECT pg_get_functiondef(oid) FROM pg_proc " "WHERE pronamespace = 'public'::regnamespace AND proname = %s"
)


def reinstall_and_retire_the_old_name(apps, schema_editor):
    install(schema_editor)
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(DEFINITION, [CURRENT_PARTY])
        row = cursor.fetchone()
        if row and RETIRED in row[0]:
            cursor.execute(row[0].replace(RETIRED, PRINCIPAL_ACCOUNTS))
        cursor.execute(f"DROP FUNCTION IF EXISTS {RETIRED}()")


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0010_policies_for_the_tables_that_had_none"),
        ("tokens", "0040_swap_parent_identity"),
        ("users", "0023_one_account_per_person"),
    ]

    operations = [migrations.RunPython(reinstall_and_retire_the_old_name, migrations.RunPython.noop)]
