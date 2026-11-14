from pathlib import Path

from django.conf import settings
from django.db import migrations

from authentication import terms_guards
from companies import authority_guards, signup_terms_guards
from tokens.database_mirror_guards import _function

REPLACED = (
    (Path(terms_guards.__file__).with_suffix(".sql").read_text(), "authentication_guard_terms_acceptance"),
    (authority_guards.SQL, "companies_guard_initial_appointment"),
    (Path(signup_terms_guards.__file__).with_suffix(".sql").read_text(), "companies_guard_signup_terms_acceptance"),
)


def install_current_terms(apps, schema_editor):
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


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0007_activate_at_signup"),
        ("authentication", "0002_terms_acceptance"),
    ]

    operations = [migrations.RunPython(install_current_terms, migrations.RunPython.noop)]
