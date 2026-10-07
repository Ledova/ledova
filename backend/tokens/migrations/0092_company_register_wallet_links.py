import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def restore_owner_submissions(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["tokens_registerwalletlink"])


def close_owner_submissions(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registerwalletlink"])
    grant_reachable_tables(schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0091_company_particulars_change_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(migrations.RunPython.noop, restore_owner_submissions),
        migrations.CreateModel(
            name="RegisterWalletLinkDecision",
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
        migrations.AddField(
            model_name="registerwalletlink",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlink",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AlterField(
            model_name="registerwalletlink",
            name="source_document",
            field=models.UUIDField(null=True),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlink",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("authority_evidence__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("authority_evidence__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("source_document__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_wallet_link_exact_provenance",
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlinkdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlinkdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlinkdecision",
            name="register_wallet_link",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerwalletlink"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlinkdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_wallet_link_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlinkdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_wallet_link",),
                name="one_register_wallet_link_outcome",
            ),
        ),
        migrations.RunPython(close_owner_submissions, migrations.RunPython.noop),
    ]
