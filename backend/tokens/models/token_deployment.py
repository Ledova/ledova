from django.db import models

from shared.models import BaseModel
from tokens.querysets.token_deployment import TokenDeploymentQuerySet


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

    objects = TokenDeploymentQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
