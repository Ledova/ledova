from django.conf import settings
from django.db import models

from shared.models import BaseModel


class RegisterDecisionKind(models.TextChoices):
    APPROVE = "approve", "Approve"
    APPLY = "apply", "Apply"
    REJECT = "reject", "Reject"


class RegisterDecision(BaseModel):
    kind = models.CharField(max_length=8, choices=RegisterDecisionKind.choices)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()
    digest = models.CharField(max_length=64)
    reason = models.CharField(max_length=1000, blank=True)
    decided_at = models.DateTimeField()

    class Meta:
        abstract = True
        ordering = ["decided_at", "uuid"]
