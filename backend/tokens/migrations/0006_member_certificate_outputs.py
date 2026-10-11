import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.member_certificate


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0002_initial"),
        ("tokens", "0005_member_access"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MemberCertificateFulfilment",
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
                ("instruction", models.CharField(max_length=255)),
                ("source_snapshot", models.JSONField()),
                ("source_digest", models.CharField(max_length=64)),
                ("digest", models.CharField(max_length=64)),
                ("file_size", models.PositiveBigIntegerField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.member_certificate.member_certificate_path,
                    ),
                ),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "export",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_fulfilment",
                        to="tokens.registerexport",
                    ),
                ),
                (
                    "produced_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="fulfilment",
                        to="tokens.membercertificaterequest",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
    ]
