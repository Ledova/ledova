from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from operators.models import STABLECOIN_ONLY
from shared.models import BaseModel
from tokens.querysets.mint_request import MintRequestQuerySet


class MintRequestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    EXECUTING = "executing", "Outcome unresolved"
    EXECUTED = "executed", "Executed"
    FAILED = "failed", "Failed"
    REJECTED = "rejected", "Rejected"


class MintRequest(BaseModel):

    dispatch_id = models.UUIDField(default=uuid4, null=True, editable=False)
    execution_intent = models.JSONField(null=True, editable=False)
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="mint_request", editable=False
    )

    settlement_asset = models.ForeignKey(
        "assets.Asset",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="mint_requests",
        limit_choices_to=STABLECOIN_ONLY,
        help_text="The settlement asset being minted (if applicable)",
    )

    yield_token = models.ForeignKey(
        "tokens.YieldToken",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="mint_requests",
        help_text="The yield token being minted (if applicable)",
    )

    recipient_address = models.CharField(
        max_length=42,
        help_text="Wallet address to receive the minted tokens",
    )

    recipient_name = models.CharField(
        max_length=200,
        help_text="Name of the recipient (for audit purposes)",
    )

    amount = models.BigIntegerField(
        help_text=(
            "Amount to mint in raw units "
            "(e.g., 10000 = $100.00 for 2-decimal stablecoin, 1000000 = 1.000000 for 6-decimal yield token)"
        ),
    )

    status = models.CharField(
        max_length=20,
        choices=MintRequestStatus.choices,
        default=MintRequestStatus.PENDING,
    )

    deposit_reference = models.CharField(
        max_length=100,
        help_text="Synthetic scenario reference or test case ID",
    )

    deposit_date = models.DateField(
        help_text="Date assigned to the synthetic scenario",
    )

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="mint_requests_created",
        help_text="Staff member who created this request",
    )

    executed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="mint_requests_executed",
        help_text="Staff member who executed this request",
    )

    executed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp when the mint was executed",
    )

    transaction = models.ForeignKey(
        "blockchain.BlockchainTransaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mint_requests",
    )

    notes = models.TextField(
        blank=True,
        help_text="Additional notes about this mint request",
    )

    rejection_reason = models.TextField(
        blank=True,
        help_text="Reason for rejection (if rejected)",
    )

    error_message = models.TextField(
        blank=True,
        help_text="Error message if mint failed",
    )

    objects = MintRequestQuerySet.as_manager()

    class Meta:
        verbose_name = "Mint Request"
        verbose_name_plural = "Mint Requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["deposit_reference"]),
            models.Index(fields=["recipient_address"]),
        ]

    def __str__(self):
        token = self.token
        symbol = token.symbol if token else "?"
        return f"Mint {self.amount_display} {symbol} to {self.recipient_name} ({self.get_status_display()})"

    def clean(self):
        super().clean()
        has_settlement_asset = self.settlement_asset_id is not None
        has_yield_token = self.yield_token_id is not None
        if has_settlement_asset == has_yield_token:
            raise ValidationError("Exactly one of settlement_asset or yield_token must be set.")

    @property
    def token(self):
        return self.settlement_asset or self.yield_token

    @property
    def amount_display(self) -> str:
        token = self.token
        decimals = self.execution_intent["decimals"] if self.execution_intent else token.decimals if token else 2
        return f"{Decimal(self.amount).scaleb(-decimals):,.{decimals}f}"

    @property
    def can_be_executed(self) -> bool:
        return self.dispatch_id is not None and self.status in (
            MintRequestStatus.PENDING,
            MintRequestStatus.APPROVED,
            MintRequestStatus.FAILED,
            MintRequestStatus.EXECUTING,
        )

    @property
    def can_be_rejected(self) -> bool:
        return self.execution_intent is None and self.status in (MintRequestStatus.PENDING, MintRequestStatus.APPROVED)
