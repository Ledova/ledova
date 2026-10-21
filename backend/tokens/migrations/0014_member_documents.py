import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import tokens.database_member_documents


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0006_status_changes_require_change_permission"),
        ("tokens", "0013_award_person_records"),
        ("shared", "0015_optional_mirror_beneficial_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterMemberDocument",
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
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("share_certificate", "Share certificate"),
                            ("shareholder_agreement", "Shareholder agreement"),
                            ("subscription_agreement", "Subscription agreement"),
                            ("other", "Other supporting document"),
                        ],
                        max_length=24,
                    ),
                ),
                ("snapshot", models.JSONField()),
                ("idempotency_key", models.UUIDField()),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="companies.company",
                    ),
                ),
                (
                    "evidence",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="tokens.registerevidence",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="documents",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "source_import",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="tokens.registerimport",
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_documents",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("recorded_by", "idempotency_key"), name="one_member_document_per_key"
                    ),
                    models.UniqueConstraint(fields=("member", "token", "evidence"), name="one_member_class_document"),
                ],
            },
        ),
        migrations.RunPython(tokens.database_member_documents.install, reverse_code=migrations.RunPython.noop),
    ]
