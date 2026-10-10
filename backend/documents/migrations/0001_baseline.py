import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import documents.models.document
import shared.storage


class Migration(migrations.Migration):

    replaces = [
        ("documents", "0001_initial"),
        ("documents", "0002_document_private_storage"),
        ("documents", "0003_documentread_document_attached_at_and_more"),
    ]

    initial = True

    dependencies = [
        ("authentication", "__first__"),
        ("users", "0001_baseline"),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentRead",
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
                ("actor_id", models.PositiveBigIntegerField()),
                ("document_uuid", models.UUIDField(db_index=True)),
                ("classification_uuid", models.UUIDField(blank=True, null=True)),
                (
                    "kind",
                    models.CharField(
                        choices=[("document", "Document"), ("file", "File"), ("extraction", "Extraction")],
                        max_length=16,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Document",
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
                ("attached_at", models.DateTimeField(blank=True, null=True)),
                ("purged_at", models.DateTimeField(blank=True, null=True)),
                (
                    "document_type",
                    models.CharField(
                        choices=[
                            ("payslip", "Payslip"),
                            ("bank_statement", "Bank Statement"),
                            ("tax_return", "Tax Return"),
                            ("other", "Other"),
                        ],
                        default="payslip",
                        max_length=32,
                    ),
                ),
                ("original_filename", models.CharField(max_length=255)),
                ("mime_type", models.CharField(blank=True, max_length=64)),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=documents.models.document.document_upload_path,
                    ),
                ),
                ("note", models.CharField(blank=True, max_length=255)),
                (
                    "classification",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="supporting_documents",
                        to="users.investorclassification",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="documents",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Document",
                "verbose_name_plural": "Documents",
                "db_table": "documents",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="DocumentExtraction",
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
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("running", "Running"),
                            ("succeeded", "Succeeded"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("model_name", models.CharField(blank=True, max_length=64)),
                ("raw_output", models.TextField(blank=True)),
                ("parsed_json", models.JSONField(blank=True, null=True)),
                ("confidence", models.FloatField(blank=True, null=True)),
                ("warnings", models.JSONField(blank=True, default=list)),
                ("error", models.TextField(blank=True)),
                ("duration_ms", models.IntegerField(blank=True, null=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="extractions", to="documents.document"
                    ),
                ),
            ],
            options={
                "verbose_name": "Document Extraction",
                "verbose_name_plural": "Document Extractions",
                "db_table": "document_extractions",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="document",
            index=models.Index(fields=["uploaded_by", "document_type"], name="documents_uploade_f4c69d_idx"),
        ),
        migrations.AddIndex(
            model_name="documentextraction",
            index=models.Index(fields=["document", "status"], name="document_ex_documen_effc26_idx"),
        ),
    ]
