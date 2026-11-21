from pathlib import Path

from django.conf import settings

from companies.disposal_guards import install as install_disposal
from tokens.database_mirror_guards import _function
from tokens.database_mirror_guards import install as install_mirror

GUARDS = ("tokens_guard_register_entry", "tokens_guard_register_position", "tokens_guard_member_cessation")


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(Path(__file__).with_suffix(".sql").read_text())
        cursor.execute("REVOKE ALL ON FUNCTION tokens_reproject_register() FROM PUBLIC")


def install_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    install_disposal(apps, schema_editor)
    source = Path(__file__).with_name("database_guards.sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for name in GUARDS:
            statement = _function(source, name)
            cursor.execute(
                statement.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate).replace("__APP__", app)
            )
    install_mirror(apps, schema_editor)
    install(apps, schema_editor)
