from django.db import models

from shared.models import BaseModel
from tokens.querysets.token_deployment import TokenDeploymentQuerySet


class SwapApprovalOutcome(models.TextChoices):
    PENDING = "pending", "Pending approval"
    EXECUTING = "executing", "Approval in progress"
    CONFIRMED = "confirmed", "Approval confirmed"
    OBSERVED_APPROVED = "observed_approved", "Existing approval observed"
    NOT_CONFIGURED = "not_configured", "Swap unavailable at deployment"
    FAILED = "failed", "Approval failed"


class TokenDeployment(BaseModel):
    token_id = models.UUIDField(unique=True, editable=False)
    company_id = models.UUIDField(editable=False)
    principal_id = models.PositiveBigIntegerField(null=True, editable=False)
    intent = models.JSONField(editable=False)
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="token_deployment"
    )
    transaction = models.ForeignKey(
        "blockchain.BlockchainTransaction", on_delete=models.PROTECT, null=True, related_name="token_deployments"
    )
    contract_address = models.CharField(max_length=42, blank=True)
    attribution_required = models.BooleanField(default=False)
    projected_at = models.DateTimeField(null=True)
    approval_intent = models.JSONField(null=True, editable=False)
    approval_outcome = models.CharField(max_length=24, choices=SwapApprovalOutcome.choices, blank=True, editable=False)
    approval_operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="swap_approval"
    )
    approval_transaction = models.ForeignKey(
        "blockchain.BlockchainTransaction", on_delete=models.PROTECT, null=True, related_name="swap_approvals"
    )
    approval_retry_of = models.UUIDField(null=True, editable=False)
    approval_observation = models.JSONField(null=True, editable=False)

    objects = TokenDeploymentQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
