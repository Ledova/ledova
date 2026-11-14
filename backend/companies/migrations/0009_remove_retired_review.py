from django.conf import settings
from django.db import migrations, models

from companies import database_guards
from tokens.database_mirror_guards import _function

RETIRED_TO_DRAFT = """
    UPDATE companies_company
    SET status = 'draft', lifecycle_revision = lifecycle_revision + 1, updated_at = clock_timestamp()
    WHERE status IN ('submitted', 'review', 'info_required', 'approved', 'rejected', 'withdrawn')
"""


def retire_review(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        cursor.execute(
            _function(database_guards.SQL, "companies_guard_administration")
            .replace("@OPERATOR_ROLE@", operator)
            .replace("@MIGRATE_ROLE@", migrate)
            .replace("@APP_ROLE@", app)
        )
        cursor.execute(RETIRED_TO_DRAFT)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0008_terms_2026_11_15"),
    ]

    operations = [
        migrations.RunPython(retire_review, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="company",
            name="additional_info_response",
        ),
        migrations.RemoveField(
            model_name="company",
            name="approved_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="approved_by",
        ),
        migrations.RemoveField(
            model_name="company",
            name="info_request_reason",
        ),
        migrations.RemoveField(
            model_name="company",
            name="info_requested_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="rejected_by",
        ),
        migrations.RemoveField(
            model_name="company",
            name="rejection_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="rejection_reason",
        ),
        migrations.RemoveField(
            model_name="company",
            name="review_completed_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="review_started_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="submitted_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="submitted_by",
        ),
        migrations.RemoveField(
            model_name="company",
            name="withdrawal_reason",
        ),
        migrations.RemoveField(
            model_name="company",
            name="withdrawn_at",
        ),
        migrations.AlterField(
            model_name="company",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("active", "Active"),
                    ("warning", "Compliance Warning"),
                    ("suspended", "Suspended"),
                    ("delisted", "Delisted"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
    ]
