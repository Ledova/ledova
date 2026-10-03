from django.db import migrations

DEFINITION = "SELECT pg_get_functiondef('companies_guard_authority_request'::regproc)"
CAPABILITIES = "('admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'))"
ADMITS_NULL = f"WHERE value NOT IN {CAPABILITIES}"
REFUSES_NULL = f"WHERE value IS NULL OR value NOT IN {CAPABILITIES}"


def _replace(old, new):
    def replace(apps, schema_editor):
        if schema_editor.connection.vendor != "postgresql":
            return
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(DEFINITION)
            guard = cursor.fetchone()[0]
            if guard.count(old) != 1:
                raise RuntimeError(
                    "The authority request guard no longer has the capability check this migration replaces."
                )
            cursor.execute(guard.replace(old, new))

    return replace


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0013_company_authority_request_withdrawal"),
    ]

    operations = [
        migrations.RunPython(_replace(ADMITS_NULL, REFUSES_NULL), _replace(REFUSES_NULL, ADMITS_NULL)),
    ]
