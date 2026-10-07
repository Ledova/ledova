import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def restrict_deployment_sources(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        for table in ("tokens_registerdeployment", "tokens_registerdeploymentdecision"):
            cursor.execute(f"REVOKE ALL ON {table} FROM {app_role}")
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {operator_role}")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0097_company_register_transfer_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterDeployment",
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
                ("snapshot", models.JSONField()),
                ("intent", models.JSONField()),
                ("intent_digest", models.CharField(max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("deployment_id", models.UUIDField(editable=False, null=True, unique=True)),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_deployments",
                        to="companies.company",
                    ),
                ),
                (
                    "preparing_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_deployments",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="source_deployment",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="execution",
                to="tokens.registerdeployment",
            ),
        ),
        migrations.CreateModel(
            name="RegisterDeploymentDecision",
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
                    "kind",
                    models.CharField(
                        choices=[("approve", "Approve"), ("apply", "Apply"), ("reject", "Reject")], max_length=8
                    ),
                ),
                ("idempotency_key", models.UUIDField()),
                ("digest", models.CharField(max_length=64)),
                ("reason", models.CharField(blank=True, max_length=1000)),
                ("decided_at", models.DateTimeField()),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register_deployment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerdeployment",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerdeploymentdecision",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerdeploymentdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_deployment_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerdeploymentdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_deployment",),
                name="one_register_deployment_outcome",
            ),
        ),
        migrations.RunPython(restrict_deployment_sources, migrations.RunPython.noop),
    ]
