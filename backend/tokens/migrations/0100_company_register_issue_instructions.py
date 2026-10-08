import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_instruction


def install_issue_policies(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["tokens_registerinstruction"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON tokens_registerinstructiondecision FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_registerinstructiondecision TO {operator_role}")


def remove_issue_policies(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registerinstructiondecision, tokens_registerinstruction, tokens_shareissuanceexecution IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_registerinstruction WHERE preparing_appointment_id IS NOT NULL) OR EXISTS (SELECT 1 FROM tokens_registerinstructiondecision) OR EXISTS (SELECT 1 FROM tokens_shareissuanceexecution WHERE source_instruction_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company issue sources, decisions and original execution history.")
        from shared.db.policies import (
            ADMITTED,
            MANAGEABLE_COMPANIES,
            PRINCIPAL,
            VISIBLE_COMPANIES,
        )

        readable = f"company_id IN (SELECT {VISIBLE_COMPANIES}())"
        writable = f"company_id IN (SELECT {MANAGEABLE_COMPANIES}()) AND submitted_by_id = {PRINCIPAL} AND status = 'submitted'"
        for suffix in ("read", "insert", "update", "delete"):
            cursor.execute(f"DROP POLICY IF EXISTS tokens_registerinstruction_{suffix} ON tokens_registerinstruction")
        cursor.execute(
            f"CREATE POLICY tokens_registerinstruction_read ON tokens_registerinstruction FOR SELECT USING ({ADMITTED} AND ({readable}))"
        )
        cursor.execute(
            f"CREATE POLICY tokens_registerinstruction_insert ON tokens_registerinstruction FOR INSERT WITH CHECK ({ADMITTED} AND ({writable}))"
        )
        cursor.execute(
            f"CREATE POLICY tokens_registerinstruction_update ON tokens_registerinstruction FOR UPDATE USING ({ADMITTED} AND ({readable})) WITH CHECK ({ADMITTED} AND ({writable}))"
        )
        cursor.execute(
            f"CREATE POLICY tokens_registerinstruction_delete ON tokens_registerinstruction FOR DELETE USING ({ADMITTED} AND ({writable}))"
        )
        for suffix in ("read", "insert", "update", "delete"):
            cursor.execute(
                f"DROP POLICY IF EXISTS tokens_registerinstructiondecision_{suffix} ON tokens_registerinstructiondecision"
            )


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0099_company_register_deployment_guards"),
        ("whitelist", "0011_company_wallet_instruction_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="registerinstruction",
            name="acceptance_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="acceptance_file",
            field=models.FileField(
                blank=True,
                null=True,
                max_length=255,
                storage=shared.storage.private_storage,
                upload_to=tokens.models.register_instruction.instruction_evidence_path,
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="acceptance_fingerprint",
            field=models.CharField(max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="acceptance_required",
            field=models.BooleanField(null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="acceptance_snapshot",
            field=models.JSONField(null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="intent",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="intent_digest",
            field=models.CharField(editable=False, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="member",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="nomination",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletnomination",
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="request",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_instruction",
                to="tokens.shareissuancerequest",
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="snapshot",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms",
            field=models.CharField(max_length=1000, null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms_file",
            field=models.FileField(
                blank=True,
                null=True,
                max_length=255,
                storage=shared.storage.private_storage,
                upload_to=tokens.models.register_instruction.instruction_evidence_path,
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms_fingerprint",
            field=models.CharField(max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms_on",
            field=models.DateField(null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms_snapshot",
            field=models.JSONField(null=True),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="wallet_approval",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="whitelist.whitelistchange"
            ),
        ),
        migrations.AddField(
            model_name="shareissuanceexecution",
            name="source_instruction",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="executions",
                to="tokens.registerinstruction",
            ),
        ),
        migrations.AlterField(
            model_name="registerinstruction",
            name="source_document",
            field=models.UUIDField(null=True),
        ),
        migrations.CreateModel(
            name="RegisterInstructionDecision",
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
                    "instruction",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decisions",
                        to="tokens.registerinstruction",
                    ),
                ),
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerinstructiondecision",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerinstructiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_issue_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerinstructiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("instruction",),
                name="one_register_issue_outcome",
            ),
        ),
        migrations.RunPython(install_issue_policies, remove_issue_policies),
    ]
