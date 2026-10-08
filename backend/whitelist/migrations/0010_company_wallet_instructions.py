import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def restrict_wallet_sources(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        for table in (
            "whitelist_companywalletnomination",
            "whitelist_companywalletinstruction",
            "whitelist_companywalletinstructiondecision",
        ):
            cursor.execute(f"REVOKE ALL ON {table} FROM {app_role}")
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {operator_role}")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0099_company_register_deployment_guards"),
        ("blockchain", "0008_fresh_signer_bootstrap"),
        ("companies", "0022_company_wallet_lock_order"),
        ("users", "0035_retire_staff_source_review"),
        ("wallets", "0025_wallet_possession_proof_guards"),
        ("whitelist", "0009_company_eligibility_invalidation"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyWalletInstruction",
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
                    "action",
                    models.CharField(choices=[("add", "Add"), ("remove", "Remove")], editable=False, max_length=6),
                ),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("snapshot", models.JSONField(editable=False)),
                ("intent", models.JSONField(editable=False)),
                ("intent_digest", models.CharField(editable=False, max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("change_id", models.UUIDField(editable=False, null=True, unique=True)),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="CompanyWalletInstructionDecision",
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
            ],
            options={
                "ordering": ["decided_at", "uuid"],
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="CompanyWalletNomination",
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
                ("wallet_id", models.UUIDField(editable=False)),
                ("snapshot", models.JSONField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("preview_digest", models.CharField(editable=False, max_length=64)),
                ("sharing_accepted", models.BooleanField(editable=False)),
                ("submitted_at", models.DateTimeField(editable=False)),
            ],
            options={
                "ordering": ["-submitted_at", "-uuid"],
            },
        ),
        migrations.RemoveConstraint(
            model_name="whitelistchange",
            name="whitelist_change_authority",
        ),
        migrations.AlterField(
            model_name="whitelistchange",
            name="authority",
            field=models.CharField(
                choices=[
                    ("operator_api", "Operator API"),
                    ("whitelist_admin", "Whitelist administration"),
                    ("subscription_admin", "Subscription administration"),
                    ("refresh", "Eligibility invalidation"),
                    ("company", "Company instruction"),
                ],
                editable=False,
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="wallet_instructions", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="target_change",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="whitelist.whitelistchange"
            ),
        ),
        migrations.AddField(
            model_name="whitelistchange",
            name="source_instruction",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletinstruction",
            ),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("authority__in", ["operator_api", "whitelist_admin", "subscription_admin", "refresh", "company"])
                ),
                name="whitelist_change_authority",
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstructiondecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstructiondecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstructiondecision",
            name="instruction",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="decisions",
                to="whitelist.companywalletinstruction",
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletinstructiondecision",
            ),
        ),
        migrations.AddField(
            model_name="companywalletnomination",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="wallet_nominations", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companywalletnomination",
            name="decision",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="wallet_nominations",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="companywalletnomination",
            name="proof",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="wallets.walletpossessionproof"
            ),
        ),
        migrations.AddField(
            model_name="companywalletnomination",
            name="request",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="wallet_nominations",
                to="users.companyeligibilityrequest",
            ),
        ),
        migrations.AddField(
            model_name="companywalletnomination",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companywalletinstruction",
            name="nomination",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletnomination",
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletinstructiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_company_wallet_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletinstructiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("instruction",),
                name="one_company_wallet_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletnomination",
            constraint=models.CheckConstraint(
                condition=models.Q(("sharing_accepted", True)), name="wallet_nomination_shared"
            ),
        ),
        migrations.AddConstraint(
            model_name="companywalletinstruction",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("action", "add"),
                        ("expires_at__isnull", False),
                        ("nomination__isnull", False),
                        ("target_change__isnull", True),
                    ),
                    models.Q(
                        ("action", "remove"),
                        ("expires_at__isnull", True),
                        ("nomination__isnull", True),
                        ("target_change__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="company_wallet_instruction_source",
            ),
        ),
        migrations.RunPython(restrict_wallet_sources, migrations.RunPython.noop),
    ]
