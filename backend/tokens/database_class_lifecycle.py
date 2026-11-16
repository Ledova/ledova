from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = Path(__file__).with_suffix(".sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'tokens_sharetoken'::regclass "
            "AND attname = 'deleted_at' AND NOT attisdropped)"
        )
        if not cursor.fetchone()[0]:
            return
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_ident(%s), quote_ident(%s)",
            [
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["migrate"],
                settings.RLS_ROLES["operator"],
                settings.RLS_ROLES["migrate"],
            ],
        )
        operator, migrate, operator_role, migrate_role = cursor.fetchone()
        sources = {
            "database_guards.sql": ("tokens_guard_register_import_decision", "tokens_check_register_import_decision"),
            "database_mirror_guards.sql": ("tokens_validate_mirror_import",),
        }
        for filename, functions in sources.items():
            statements = Path(__file__).with_name(filename).read_text()
            source += "\n" + "\n".join(_function(statements, name) for name in functions)
        cursor.execute(source.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))
        cursor.execute("REVOKE ALL ON FUNCTION tokens_class_details_available(uuid, boolean) FROM PUBLIC")
        cursor.execute(
            "GRANT EXECUTE ON FUNCTION tokens_class_details_available(uuid, boolean) "
            f"TO {operator_role}, {migrate_role}"
        )

        cursor.execute("REVOKE ALL ON FUNCTION tokens_class_deletion_reason(uuid) FROM PUBLIC")
        cursor.execute(
            f"GRANT EXECUTE ON FUNCTION tokens_class_deletion_reason(uuid) TO {operator_role}, {migrate_role}"
        )

        cursor.execute("REVOKE ALL ON FUNCTION tokens_class_history_empty(uuid) FROM PUBLIC")
        cursor.execute(f"GRANT EXECUTE ON FUNCTION tokens_class_history_empty(uuid) TO {operator_role}, {migrate_role}")

        cursor.execute(
            "REVOKE ALL ON FUNCTION tokens_class_review_retirement(uuid, bigint, uuid, uuid, uuid, text) FROM PUBLIC"
        )
        cursor.execute(
            "GRANT EXECUTE ON FUNCTION tokens_class_review_retirement(uuid, bigint, uuid, uuid, uuid, text) "
            f"TO {operator_role}, {migrate_role}"
        )
