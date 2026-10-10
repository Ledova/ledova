import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [
        ("shared", "0001_initial"),
        ("shared", "0002_drop_celery_tables"),
        ("shared", "0003_rls_roles_and_grants"),
        ("shared", "0004_rls_policies"),
        ("shared", "0005_rls_principal_missing_ok"),
        ("shared", "0006_account_insert_by_director"),
        ("shared", "0007_review_request_policies"),
        ("shared", "0008_scoped_role_table_grants"),
        ("shared", "0009_policies_require_a_principal"),
        ("shared", "0010_policies_for_the_tables_that_had_none"),
        ("shared", "0011_the_helper_names_the_principal"),
        ("shared", "0012_operator_creates_matches"),
        ("shared", "0013_policies_without_the_dropped_tables"),
    ]

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Country",
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
                ("name", models.CharField(blank=True, max_length=100, null=True)),
                ("code", models.CharField(blank=True, max_length=3, null=True)),
                ("dial_code", models.CharField(blank=True, max_length=10, null=True)),
                ("is_available", models.BooleanField(default=True)),
            ],
            options={
                "verbose_name_plural": "Countries",
            },
        ),
    ]
