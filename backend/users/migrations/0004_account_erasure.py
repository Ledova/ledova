import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def restrict_erasure_work(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)",
            [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]],
        )
        app, operator = cursor.fetchone()
        cursor.execute("ALTER TABLE users_accounterasureworkitem ENABLE ROW LEVEL SECURITY")
        cursor.execute("ALTER TABLE users_accounterasureworkitem FORCE ROW LEVEL SECURITY")
        cursor.execute(f"REVOKE ALL ON users_accounterasureworkitem FROM {app}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON users_accounterasureworkitem TO {operator}")


class Migration(migrations.Migration):
    dependencies = [("users", "0003_remove_investor_eligibility"), ("shared", "0002_database_guards")]

    operations = [
        migrations.CreateModel(
            name="AccountErasureWorkItem",
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
                    "provider",
                    models.CharField(choices=[("kycaid", "KYCAID"), ("sumsub", "Sumsub")], max_length=20),
                ),
                ("applicant_id", models.CharField(max_length=100)),
                ("completion_email", models.EmailField(blank=True, max_length=254)),
                ("completed_at", models.DateTimeField(editable=False, null=True)),
                ("confirmation_reference", models.CharField(blank=True, editable=False, max_length=255)),
                ("hold_reason", models.CharField(blank=True, editable=False, max_length=255)),
                ("review_due_at", models.DateTimeField(editable=False, null=True)),
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
                    models.UniqueConstraint(
                        fields=("user", "provider", "applicant_id"),
                        condition=~models.Q(applicant_id=""),
                        name="users_pending_provider_erasure",
                    ),
                    models.CheckConstraint(
                        condition=(
                            models.Q(completed_at__isnull=True, confirmation_reference="") & ~models.Q(applicant_id="")
                            | models.Q(completed_at__isnull=False, applicant_id="", completion_email="")
                            & ~models.Q(confirmation_reference="")
                        ),
                        name="users_provider_erasure_completion",
                    ),
                    models.CheckConstraint(
                        condition=(
                            models.Q(hold_reason="", review_due_at__isnull=True)
                            | ~models.Q(hold_reason="")
                            & models.Q(review_due_at__isnull=False, completed_at__isnull=True)
                        ),
                        name="users_provider_erasure_hold",
                    ),
                ]
            },
        ),
        migrations.RunPython(restrict_erasure_work),
    ]
