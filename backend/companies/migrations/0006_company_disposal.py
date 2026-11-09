import uuid

from django.db import migrations, models

from companies.disposal_guards import install_current_guards


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0005_signup_terms_version"),
        ("tokens", "0007_register_follows_profile"),
        ("users", "0004_account_erasure"),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyDisposal",
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
                ("company_id", models.UUIDField(unique=True)),
                ("manifest", models.JSONField()),
                ("digest", models.CharField(max_length=64)),
                ("authorisation_reference", models.CharField(max_length=255)),
                ("export_digest", models.CharField(max_length=64)),
                ("handover_reference", models.CharField(max_length=255)),
                ("purpose_review_reference", models.CharField(max_length=255)),
                ("transaction_id", models.BigIntegerField(null=True)),
                ("database_disposed_at", models.DateTimeField(null=True)),
                ("pending_files", models.JSONField(default=list)),
                ("completed_at", models.DateTimeField(null=True)),
            ],
        ),
        migrations.RunPython(install_current_guards),
    ]
