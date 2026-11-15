import django.db.models.deletion
import django.db.models.manager
from django.conf import settings
from django.db import migrations, models

from tokens.database_class_lifecycle import install


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0001_initial"),
        ("companies", "0009_remove_retired_review"),
        ("tokens", "0008_class_lifecycle"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="sharetoken",
            options={
                "base_manager_name": "all_objects",
                "default_manager_name": "objects",
                "ordering": ["-created_at"],
                "verbose_name": "Share Token",
                "verbose_name_plural": "Share Tokens",
            },
        ),
        migrations.AlterModelManagers(
            name="sharetoken",
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RemoveConstraint(
            model_name="sharetoken",
            name="unique_company_symbol",
        ),
        migrations.AddField(
            model_name="sharetoken",
            name="deleted_at",
            field=models.DateTimeField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="sharetoken",
            name="deleted_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("deleted_at__isnull", True), ("deleted_by__isnull", True)),
                    models.Q(("deleted_at__isnull", False), ("deleted_by__isnull", False)),
                    _connector="OR",
                ),
                name="share_class_deletion_attribution",
            ),
        ),
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("company", "symbol"),
                name="unique_company_symbol",
            ),
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
