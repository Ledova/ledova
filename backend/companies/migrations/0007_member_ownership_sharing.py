import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import companies.database_workflow_guards


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0006_status_changes_require_change_permission"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="share_ownership_with_members",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="company",
            name="ownership_sharing_changed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="company",
            name="ownership_sharing_changed_at",
            field=models.DateTimeField(editable=False, null=True),
        ),
        migrations.RunPython(companies.database_workflow_guards.install),
    ]
