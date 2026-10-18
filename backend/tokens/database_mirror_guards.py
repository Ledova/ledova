import re
from pathlib import Path

from django.conf import settings

SQL = Path(__file__).with_suffix(".sql").read_text()


def _function(source, name):
    matches = list(
        re.finditer(
            rf"CREATE (?:OR REPLACE )?FUNCTION (?:public[.])?{re.escape(name)}\("
            r".*?(?P<tag>\$[A-Za-z0-9_]*\$).*?(?P=tag);",
            source,
            re.DOTALL,
        )
    )
    if not matches:
        raise ValueError(f"Missing register guard {name}")
    return matches[-1].group().replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_name("database_guards.sql").read_text()
    guard = _function(source, "tokens_guard_register_import")
    guard = guard.replace(
        "BEGIN\n",
        "BEGIN\n    IF (TG_OP = 'DELETE' AND OLD.source_reference <> '') OR NEW.source_reference <> '' THEN\n"
        "        RETURN tokens_validate_mirror_import(NEW, OLD, TG_OP);\n    END IF;\n",
        1,
    )
    entry = _function(source, "tokens_guard_register_entry").replace(
        "('opening', 'issue', 'transfer', 'cessation', 'correction')",
        "('opening', 'issue', 'transfer', 'cessation', 'correction', 'mirror_correction')",
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["migrate"],
                settings.RLS_ROLES["app"],
            ],
        )
        operator, migrate, app = cursor.fetchone()
        compiled = SQL + "\n" + guard + "\n" + entry
        cursor.execute(
            compiled.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate).replace("__APP__", app)
        )
