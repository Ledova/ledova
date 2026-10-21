import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import tokens.database_class_rights


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0006_status_changes_require_change_permission"),
        ("tokens", "0011_required_signing_challenge_wallet"),
        ("shared", "0013_member_name_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ClassRightsRevision",
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
                ("summary", models.CharField(blank=True, max_length=4000)),
                ("document_reference", models.CharField(blank=True, max_length=255)),
                ("recorded_by_name", models.CharField(blank=True, max_length=255)),
                ("idempotency_key", models.UUIDField()),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="rights_revisions",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-revision"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("revision__gt", 0)), name="class_rights_positive_revision"
                    ),
                    models.UniqueConstraint(fields=("token", "revision"), name="one_class_rights_revision"),
                    models.UniqueConstraint(fields=("recorded_by", "idempotency_key"), name="one_class_rights_request"),
                ],
            },
        ),
        migrations.RunPython(tokens.database_class_rights.install, reverse_code=migrations.RunPython.noop),
    ]
