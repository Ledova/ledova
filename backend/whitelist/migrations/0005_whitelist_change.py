import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("whitelist", "0004_failure_reconciled_at"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WhitelistChange",
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
                ("address", models.CharField(editable=False, max_length=42)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("registry_address", models.CharField(editable=False, max_length=42)),
                ("intent", models.JSONField(editable=False)),
                (
                    "authority",
                    models.CharField(
                        choices=[
                            ("operator_api", "Operator API"),
                            ("whitelist_admin", "Whitelist administration"),
                            ("subscription_admin", "Subscription administration"),
                        ],
                        editable=False,
                        max_length=20,
                    ),
                ),
                ("requested_wallet_id", models.UUIDField(editable=False, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Checking the admitted change"),
                            ("executing", "Outcome unresolved"),
                            ("confirmed", "Confirmed"),
                            ("unchanged", "No change required"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=10,
                    ),
                ),
                ("failure_code", models.CharField(blank=True, editable=False, max_length=64)),
                ("completed_at", models.DateTimeField(editable=False, null=True)),
                ("entry_id", models.UUIDField(editable=False, null=True)),
                (
                    "initiated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "operation",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="whitelist_change",
                        to="blockchain.outgoingoperation",
                    ),
                ),
                (
                    "transaction",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="whitelist_change",
                        to="blockchain.blockchaintransaction",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("status__in", ["pending", "executing"])),
                        fields=("chain_id", "registry_address", "address"),
                        name="one_unresolved_whitelist_change",
                    ),
                    models.CheckConstraint(condition=models.Q(("chain_id__gt", 0)), name="whitelist_change_chain"),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("address__regex", "^0x[0-9a-f]{40}$"), ("registry_address__regex", "^0x[0-9a-f]{40}$")
                        ),
                        name="whitelist_change_addresses",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("action__in", ["add", "remove"])), name="whitelist_change_action"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("authority__in", ["operator_api", "whitelist_admin", "subscription_admin"])
                        ),
                        name="whitelist_change_authority",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("status__in", ["pending", "executing", "confirmed", "unchanged", "failed"])
                        ),
                        name="whitelist_change_status",
                    ),
                ],
            },
        ),
    ]
