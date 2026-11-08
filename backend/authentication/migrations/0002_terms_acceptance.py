import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from authentication import terms_guards


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0001_initial"),
        ("shared", "0002_database_guards"),
    ]

    operations = [
        migrations.CreateModel(
            name="TermsAcceptance",
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
                ("version", models.CharField(editable=False, max_length=10)),
                ("statement", models.TextField(editable=False)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("user", "version"), name="authentication_user_terms_version")
                ],
            },
        ),
        migrations.RunPython(terms_guards.install),
    ]
