from django.db import models

from shared.models import BaseModel

ADDRESS_PATTERN = r"^0x[0-9a-f]{40}$"
HASH_PATTERN = r"^0x[0-9a-f]{64}$"


class ApprovalSubmissionOutcome(models.TextChoices):
    PENDING = "pending", "Pending"
    CONFIRMED = "confirmed", "Confirmed"
    REVERTED = "reverted", "Reverted"
    SUPERSEDED = "superseded", "Superseded"


class SwapApprovalSubmission(BaseModel):
    swap = models.ForeignKey(
        "tokens.SwapOrder", on_delete=models.PROTECT, related_name="approval_submissions", editable=False
    )
    participant = models.CharField(max_length=6, editable=False)
    owner_account_id = models.UUIDField(editable=False)
    wallet_id = models.UUIDField(editable=False)
    actor_id = models.PositiveBigIntegerField(editable=False)
    settlement_digest = models.CharField(max_length=66, editable=False)
    chain_id = models.PositiveBigIntegerField(editable=False)
    sender_address = models.CharField(max_length=42, editable=False)
    token_address = models.CharField(max_length=42, editable=False)
    spender_address = models.CharField(max_length=42, editable=False)
    nonce = models.PositiveBigIntegerField(editable=False)
    tx_hash = models.CharField(max_length=66, editable=False)
    raw_transaction = models.BinaryField(editable=False)
    intent = models.JSONField(editable=False)
    last_attempt_at = models.DateTimeField(null=True, editable=False, db_index=True)
    acknowledged_at = models.DateTimeField(null=True, editable=False)
    last_error = models.CharField(max_length=100, blank=True, default="", editable=False)
    outcome = models.CharField(
        max_length=10,
        choices=ApprovalSubmissionOutcome.choices,
        default=ApprovalSubmissionOutcome.PENDING,
        editable=False,
    )
    block_number = models.PositiveBigIntegerField(null=True, editable=False)
    block_hash = models.CharField(max_length=66, blank=True, default="", editable=False)
    gas_used = models.PositiveBigIntegerField(null=True, editable=False)
    confirmed_at = models.DateTimeField(null=True, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["chain_id", "tx_hash"], name="unique_swap_approval_submission_hash"),
            models.UniqueConstraint(
                fields=["chain_id", "sender_address", "nonce"], name="unique_swap_approval_submission_nonce"
            ),
            models.CheckConstraint(condition=models.Q(chain_id__gt=0), name="swap_approval_submission_chain_id"),
            models.CheckConstraint(
                condition=models.Q(participant__in=("seller", "buyer")), name="swap_approval_submission_participant"
            ),
            models.CheckConstraint(
                condition=models.Q(tx_hash__regex=HASH_PATTERN, settlement_digest__regex=HASH_PATTERN),
                name="swap_approval_submission_hashes",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    sender_address__regex=ADDRESS_PATTERN,
                    token_address__regex=ADDRESS_PATTERN,
                    spender_address__regex=ADDRESS_PATTERN,
                ),
                name="swap_approval_submission_addresses",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        outcome__in=(ApprovalSubmissionOutcome.CONFIRMED, ApprovalSubmissionOutcome.REVERTED),
                        block_number__isnull=False,
                        block_hash__regex=HASH_PATTERN,
                        gas_used__isnull=False,
                        confirmed_at__isnull=False,
                    )
                    | models.Q(
                        outcome__in=(ApprovalSubmissionOutcome.PENDING, ApprovalSubmissionOutcome.SUPERSEDED),
                        block_number__isnull=True,
                        block_hash="",
                        gas_used__isnull=True,
                        confirmed_at__isnull=True,
                    )
                ),
                name="swap_approval_submission_receipt_present",
            ),
        ]

    def __str__(self):
        return self.tx_hash
