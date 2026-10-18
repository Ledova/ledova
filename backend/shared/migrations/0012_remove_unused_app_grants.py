from django.conf import settings
from django.db import migrations

TABLES = (
    "auth_group",
    "auth_group_permissions",
    "auth_permission",
    "authentication_customuser_groups",
    "authentication_customuser_user_permissions",
    "django_admin_log",
    "django_content_type",
    "offerings_offering_documents",
    "offerings_offering_settlement_assets",
    "procrastinate_periodic_defers",
    "procrastinate_workers",
)


def revoke_unused_app_access(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES["app"]])
        quoted_app = cursor.fetchone()[0]
        tables = ", ".join(f"public.{table}" for table in TABLES)
        cursor.execute(f"REVOKE ALL PRIVILEGES ON TABLE {tables} FROM {quoted_app}")


class Migration(migrations.Migration):
    dependencies = [("shared", "0011_remove_unused_monitoring_rule_grant")]

    operations = [migrations.RunPython(revoke_unused_app_access)]
