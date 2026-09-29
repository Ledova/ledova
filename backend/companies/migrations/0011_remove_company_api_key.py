import secrets

from django.db import migrations, models
from django.utils import timezone


def issue_each_company_a_fresh_key(apps, schema_editor):
    company = apps.get_model("companies", "Company")
    rows = company._base_manager.using(schema_editor.connection.alias)
    issued_at = timezone.now()
    for pk in rows.values_list("pk", flat=True):
        rows.filter(pk=pk).update(api_key=f"ledova_{secrets.token_hex(28)}", api_key_created_at=issued_at)


class Migration(migrations.Migration):
    dependencies = [("companies", "0010_company_pack")]

    operations = [
        migrations.AlterField(
            model_name="company",
            name="api_key",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.RunPython(migrations.RunPython.noop, issue_each_company_a_fresh_key),
        migrations.RemoveField(model_name="company", name="api_key"),
        migrations.RemoveField(model_name="company", name="api_key_created_at"),
    ]
