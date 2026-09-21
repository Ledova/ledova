from django.db import models

from shared.models import BaseModel
from tokens.querysets.issuance_execution import ShareIssuanceExecutionQuerySet


class IssuanceExecutionStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    EXECUTING = "executing", "Executing"
    EXECUTED = "executed", "Executed"
    FAILED = "failed", "Failed before signing or reverted"
    CANCELLED = "cancelled", "Cancelled before execution"


class ShareIssuanceExecution(BaseModel):
    request_id = models.UUIDField(unique=True, editable=False)
    token_id = models.UUIDField(editable=False)
    company_id = models.UUIDField(editable=False)
    subscription_id = models.UUIDField(null=True, unique=True, editable=False)
    issuance_id = models.UUIDField(null=True, unique=True, editable=False)
    executed_by_id = models.PositiveBigIntegerField(editable=False)
    authority = models.CharField(max_length=64, editable=False)
    intent = models.JSONField(editable=False)
    status = models.CharField(
        max_length=12, choices=IssuanceExecutionStatus.choices, default=IssuanceExecutionStatus.QUEUED
    )
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="share_issuance"
    )
    transaction = models.ForeignKey(
        "blockchain.BlockchainTransaction", on_delete=models.PROTECT, null=True, related_name="issuance_executions"
    )
    finalized_receipt = models.JSONField(null=True, editable=False)
    retry_of = models.UUIDField(null=True, editable=False)

    objects = ShareIssuanceExecutionQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
