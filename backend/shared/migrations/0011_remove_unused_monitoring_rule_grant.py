from django.conf import settings
from django.db import migrations


def revoke_monitoring_rule_app_access(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES["app"]])
        quoted_app = cursor.fetchone()[0]
        cursor.execute(f"REVOKE ALL PRIVILEGES ON TABLE public.compliance_monitoringrule FROM {quoted_app}")


class Migration(migrations.Migration):
    dependencies = [("shared", "0010_award_entitlement_guards")]

    operations = [migrations.RunPython(revoke_monitoring_rule_app_access)]
