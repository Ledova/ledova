from django.conf import settings
from django.db import models

from shared.models import BaseModel
from tokens.querysets.nav_update import NAVUpdateQuerySet


class NAVUpdateMode(models.TextChoices):
    HISTORICAL = "historical", "Historical"
    LOCAL = "local", "Local only"
    CHAIN = "chain", "On-chain"


class NAVUpdateStatus(models.TextChoices):
    HISTORICAL = "historical", "Historical outcome"
    QUEUED = "queued", "Queued"
    EXECUTING = "executing", "Outcome unresolved"
    CONFIRMED = "confirmed", "Receipt confirmed"
    APPLIED = "applied", "Applied locally"
    FAILED = "failed", "Refused or failed"


class NAVUpdate(BaseModel):
    mode = models.CharField(
        max_length=12, choices=NAVUpdateMode.choices, default=NAVUpdateMode.HISTORICAL, editable=False
    )
    status = models.CharField(
        max_length=12, choices=NAVUpdateStatus.choices, default=NAVUpdateStatus.HISTORICAL, editable=False
    )
    intent = models.JSONField(null=True, editable=False)
    event = models.JSONField(null=True, editable=False)
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="nav_update", editable=False
    )
    completed_at = models.DateTimeField(null=True, editable=False)
    yield_token = models.ForeignKey(
        "tokens.YieldToken",
        on_delete=models.PROTECT,
        related_name="nav_updates",
        help_text="The yield token whose NAV was updated",
    )

    old_nav_per_token = models.DecimalField(
        max_digits=20,
        decimal_places=6,
        help_text="Previous NAV per token",
    )

    new_nav_per_token = models.DecimalField(
        max_digits=20,
        decimal_places=6,
        help_text="New NAV per token",
    )

    total_reserve_value = models.DecimalField(
        max_digits=20,
        decimal_places=6,
        help_text="Synthetic reference value at time of update",
    )

    custodian_report_ref = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional synthetic scenario reference (legacy field name)",
    )

    transaction = models.ForeignKey(
        "blockchain.BlockchainTransaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="nav_updates",
        help_text="On-chain transaction for this NAV update (if executed on-chain)",
    )

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="nav_updates",
        help_text="Staff member who performed this update",
    )

    notes = models.TextField(
        blank=True,
        help_text="Additional notes about this NAV update",
    )

    objects = NAVUpdateQuerySet.as_manager()

    class Meta:
        verbose_name = "NAV Update"
        verbose_name_plural = "NAV Updates"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["yield_token"],
                condition=models.Q(mode__in=["local", "chain"], completed_at__isnull=True),
                name="one_unresolved_nav_per_token",
            ),
            models.UniqueConstraint(
                models.F("intent__contract_address"),
                condition=models.Q(mode="chain", completed_at__isnull=True),
                name="one_unresolved_nav_per_contract",
            ),
        ]

    def __str__(self):
        return f"{self.yield_token.symbol} NAV: " f"${self.old_nav_per_token} → ${self.new_nav_per_token}"
