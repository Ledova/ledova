from django.conf import settings
from django.db import models

from shared.models import BaseModel
from tokens.querysets.pause_change import PauseChangeQuerySet


class PauseAuthority(models.TextChoices):
    ISSUER = "issuer", "Issuer"
    STAFF = "staff", "Token administration"


class PauseChangeStatus(models.TextChoices):
    PENDING = "pending", "Checking the requested state"
    EXECUTING = "executing", "Transaction outcome unresolved"
    OBSERVED = "observed", "Already in the requested state"
    CONFIRMED = "confirmed", "Original transaction confirmed"
    FAILED = "failed", "Failed"


class PauseChange(BaseModel):
    token_id = models.UUIDField(editable=False)
    company_id = models.UUIDField(editable=False)
    initiated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    authority = models.CharField(max_length=6, choices=PauseAuthority.choices, editable=False)
    paused = models.BooleanField(editable=False)
    chain_id = models.PositiveBigIntegerField(editable=False)
    contract_address = models.CharField(max_length=42, editable=False)
    intent = models.JSONField(editable=False)
    status = models.CharField(max_length=10, choices=PauseChangeStatus.choices, default=PauseChangeStatus.PENDING)
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="pause_change"
    )
    observation = models.JSONField(null=True, editable=False)
    completed_at = models.DateTimeField(null=True, editable=False)

    objects = PauseChangeQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["chain_id", "contract_address"],
                condition=models.Q(completed_at__isnull=True),
                name="one_unresolved_token_pause",
            ),
            models.CheckConstraint(condition=models.Q(chain_id__gt=0), name="pause_change_chain"),
            models.CheckConstraint(
                condition=models.Q(contract_address__regex=r"^0x[0-9a-f]{40}$"), name="pause_change_address"
            ),
            models.CheckConstraint(
                condition=models.Q(authority__in=PauseAuthority.values), name="pause_change_authority"
            ),
            models.CheckConstraint(condition=models.Q(status__in=PauseChangeStatus.values), name="pause_change_status"),
        ]
