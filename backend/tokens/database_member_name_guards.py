from pathlib import Path

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_name("database_guards.sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        for name in ("tokens_register_issue_ready", "tokens_register_paid_issue_ready"):
            cursor.execute(_function(source, name))
