import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from tokens.database_class_details import install


class Migration(migrations.Migration):
    dependencies = [
        ("tokens", "0011_class_review_retirement"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ClassDetailsRevision",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("revision", models.PositiveIntegerField()),
                ("before", models.JSONField()),
                ("after", models.JSONField()),
                ("recorded_by_name", models.CharField(blank=True, max_length=255)),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyappointment",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="details_revisions",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-revision"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("revision__gt", 0)), name="class_details_positive_revision"
                    ),
                    models.UniqueConstraint(fields=("token", "revision"), name="one_class_details_revision"),
                ],
            },
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
