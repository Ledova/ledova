from django.db import models

from shared.models import BaseModel
from tokens.querysets.capital_execution import CapitalIncreaseExecutionQuerySet


class CapitalIncreaseExecution(BaseModel):
    request_id = models.UUIDField(unique=True, editable=False)
    token_id = models.UUIDField(editable=False)
    company_id = models.UUIDField(editable=False)
    executed_by_id = models.PositiveBigIntegerField(editable=False)
    intent = models.JSONField(editable=False)
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="capital_increase"
    )
    transaction = models.ForeignKey(
        "blockchain.BlockchainTransaction", on_delete=models.PROTECT, null=True, related_name="capital_increases"
    )
    retry_of = models.UUIDField(null=True, editable=False)
    attribution_evidence = models.JSONField(null=True, editable=False)
    projected_at = models.DateTimeField(null=True, editable=False)

    objects = CapitalIncreaseExecutionQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
