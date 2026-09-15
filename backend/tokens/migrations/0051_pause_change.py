import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("tokens", "0050_swap_approval_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PauseChange",
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
                ("token_id", models.UUIDField(editable=False)),
                ("company_id", models.UUIDField(editable=False)),
                (
                    "authority",
                    models.CharField(
                        choices=[("issuer", "Issuer"), ("staff", "Token administration")], editable=False, max_length=6
                    ),
                ),
                ("paused", models.BooleanField(editable=False)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("contract_address", models.CharField(editable=False, max_length=42)),
                ("intent", models.JSONField(editable=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Checking the requested state"),
                            ("executing", "Transaction outcome unresolved"),
                            ("observed", "Already in the requested state"),
                            ("confirmed", "Original transaction confirmed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=10,
                    ),
                ),
                ("observation", models.JSONField(editable=False, null=True)),
                ("completed_at", models.DateTimeField(editable=False, null=True)),
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
                        related_name="pause_change",
                        to="blockchain.outgoingoperation",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("completed_at__isnull", True)),
                        fields=("chain_id", "contract_address"),
                        name="one_unresolved_token_pause",
                    ),
                    models.CheckConstraint(condition=models.Q(("chain_id__gt", 0)), name="pause_change_chain"),
                    models.CheckConstraint(
                        condition=models.Q(("contract_address__regex", "^0x[0-9a-f]{40}$")), name="pause_change_address"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("authority__in", ["issuer", "staff"])), name="pause_change_authority"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("status__in", ["pending", "executing", "observed", "confirmed", "failed"])),
                        name="pause_change_status",
                    ),
                ],
            },
        ),
    ]
