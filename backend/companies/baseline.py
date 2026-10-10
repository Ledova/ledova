from pathlib import Path

from django.conf import settings


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        table = "companies_companyregistrycheck"
        constraints = schema_editor.connection.introspection.get_constraints(cursor, table)
        (constraint,) = [
            name
            for name, attributes in constraints.items()
            if attributes["foreign_key"] == ("companies_company", "uuid")
        ]
        quote = schema_editor.quote_name
        cursor.execute(f"ALTER TABLE {quote(table)} DROP CONSTRAINT {quote(constraint)}")
        cursor.execute(
            f"ALTER TABLE {quote(table)} ADD CONSTRAINT {quote(constraint)} "
            'FOREIGN KEY ("company_id") REFERENCES "companies_company" ("uuid") '
            "ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED"
        )
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        cursor.execute(
            Path(__file__).with_suffix(".sql").read_text()
            .replace("@OPERATOR_ROLE@", operator)
            .replace("@MIGRATE_ROLE@", migrate)
            .replace("@APP_ROLE@", app)
        )
