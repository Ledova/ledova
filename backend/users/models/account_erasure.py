from datetime import timedelta

from django.conf import settings
from django.db import models

from integrations.kyc.constants import PROVIDER_KYCAID, PROVIDER_SUMSUB
from shared.models import BaseModel


class AccountErasureWorkItem(BaseModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    provider = models.CharField(max_length=20, choices=[(PROVIDER_KYCAID, "KYCAID"), (PROVIDER_SUMSUB, "Sumsub")])
    applicant_id = models.CharField(max_length=100)
    completion_email = models.EmailField(blank=True)
    completed_at = models.DateTimeField(null=True, editable=False)
    confirmation_reference = models.CharField(max_length=255, blank=True, editable=False)
    hold_reason = models.CharField(max_length=255, blank=True, editable=False)
    review_due_at = models.DateTimeField(null=True, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "provider", "applicant_id"],
                condition=~models.Q(applicant_id=""),
                name="users_pending_provider_erasure",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(completed_at__isnull=True, confirmation_reference="") & ~models.Q(applicant_id="")
                    | models.Q(completed_at__isnull=False, applicant_id="", completion_email="")
                    & ~models.Q(confirmation_reference="")
                ),
                name="users_provider_erasure_completion",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(hold_reason="", review_due_at__isnull=True)
                    | ~models.Q(hold_reason="") & models.Q(review_due_at__isnull=False, completed_at__isnull=True)
                ),
                name="users_provider_erasure_hold",
            ),
        ]

    @property
    def due_at(self):
        return self.created_at + timedelta(days=30)
