from pathlib import Path

from django.conf import settings


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    classification_days = settings.CLASSIFICATION_EVIDENCE_RETENTION_DAYS
    document_days = settings.UNATTACHED_DOCUMENT_RETENTION_DAYS
    if any(type(value) is not int or value < 0 for value in (classification_days, document_days)):
        raise ValueError("Evidence retention periods must be nonnegative integers.")
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["migrate"],
                settings.TIME_ZONE,
                settings.RLS_ROLES["app"],
            ],
        )
        operator, migrate, time_zone, app = cursor.fetchone()
        cursor.execute(
            Path(__file__).with_suffix(".sql").read_text()
            .replace("@CLASSIFICATION_DAYS@", str(classification_days))
            .replace("@DOCUMENT_DAYS@", str(document_days))
            .replace("@OPERATOR_ROLE@", operator)
            .replace("@MIGRATE_ROLE@", migrate)
            .replace("@TIME_ZONE@", time_zone)
            .replace("@APP_ROLE@", app)
        )
