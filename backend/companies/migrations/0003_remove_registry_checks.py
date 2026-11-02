import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from companies import activation_guards, authority_guards, database_guards
from shared.db.policy_sql import install as install_policies
from tokens.database_mirror_guards import _function

KEEP_RECEIPTS = """
    INSERT INTO companies_companyactivation (uuid, created_at, updated_at, idempotency_key, lifecycle_revision,
        person_identity, issuer_identity_required, declaration_version, declaration_text, activated_at,
        activated_by_id, appointment_id, company_id)
    SELECT receipt.uuid, receipt.created_at, receipt.updated_at, receipt.idempotency_key, receipt.lifecycle_revision,
        receipt.person_identity, receipt.issuer_identity_required, receipt.declaration_version,
        receipt.declaration_text, receipt.applied_at, appointment.appointee_id, receipt.initiating_appointment_id,
        receipt.company_id
    FROM companies_companyregistrycheck receipt
    JOIN companies_companyappointment appointment ON appointment.uuid = receipt.initiating_appointment_id
    WHERE receipt.applied_at IS NOT NULL
"""

REMOVED = (
    "DROP TRIGGER IF EXISTS companies_registry_company_lock ON companies_companyregistrycheck",
    "DROP TRIGGER IF EXISTS companies_registry_receipt ON companies_companyregistrycheck",
    "DROP TRIGGER IF EXISTS companies_activation_effect ON companies_companyregistrycheck",
    "DROP FUNCTION IF EXISTS companies_current_activation_source(companies_companyregistrycheck)",
    "DROP FUNCTION IF EXISTS companies_lock_registry_company()",
    "DROP FUNCTION IF EXISTS companies_guard_registry_receipt()",
    "DROP FUNCTION IF EXISTS companies_guard_activation_effect()",
    "DROP FUNCTION IF EXISTS companies_canonical_name(text)",
)

REPLACED = (
    (authority_guards.SQL, "companies_guard_initial_appointment"),
    (database_guards.SQL, "companies_validate_invited_appointment"),
    (database_guards.SQL, "companies_guard_administration"),
)


def keep_activation_receipts(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(KEEP_RECEIPTS)
        for statement in REMOVED:
            cursor.execute(statement)


def install_activation_guards(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("contenttypes", "ContentType").objects.using(alias).filter(
        app_label="companies", model="companyregistrycheck"
    ).delete()
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for source, name in REPLACED:
            cursor.execute(
                _function(source, name)
                .replace("@OPERATOR_ROLE@", operator)
                .replace("@MIGRATE_ROLE@", migrate)
                .replace("@APP_ROLE@", app)
            )
    activation_guards.install(apps, schema_editor)
    install_policies(schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0002_initial"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("shared", "0002_database_guards"),
        ("shareholders", "0002_remove_publications"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyActivation",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("lifecycle_revision", models.PositiveBigIntegerField(editable=False)),
                ("person_identity", models.JSONField(editable=False)),
                ("issuer_identity_required", models.BooleanField(editable=False)),
                ("declaration_version", models.CharField(editable=False, max_length=10)),
                ("declaration_text", models.TextField(editable=False)),
                ("activated_at", models.DateTimeField(editable=False)),
                (
                    "activated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyappointment",
                    ),
                ),
                (
                    "company",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="activation_receipt",
                        to="companies.company",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("activated_by", "idempotency_key"), name="companies_one_activation_per_key"
                    )
                ],
            },
        ),
        migrations.RunPython(keep_activation_receipts),
        migrations.RemoveConstraint(
            model_name="companyappointment",
            name="companies_appointment_exact_source",
        ),
        migrations.RemoveField(
            model_name="companyappointment",
            name="registry_check",
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("invitation__isnull", True),
                        ("legacy_owner__isnull", True),
                        ("request__isnull", False),
                    ),
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("invitation__isnull", False),
                        ("legacy_owner__isnull", True),
                        ("request__isnull", True),
                    ),
                    models.Q(
                        ("declaration_text__isnull", True),
                        ("declaration_version__isnull", True),
                        ("invitation__isnull", True),
                        ("legacy_owner__isnull", False),
                        ("request__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="companies_appointment_exact_source",
            ),
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_check",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_status",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_reason",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_checked_at",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_entity_name",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_entity_status",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_identity",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_revision",
        ),
        migrations.RemoveField(
            model_name="company",
            name="registry_purpose",
        ),
        migrations.DeleteModel(
            name="CompanyRegistryCheck",
        ),
        migrations.RunPython(install_activation_guards),
    ]
