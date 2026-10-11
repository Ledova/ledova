from pathlib import Path


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(Path(__file__).with_suffix(".sql").read_text())
