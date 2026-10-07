from django.conf import settings
from django.db import models

from shared.models import BaseModel


class WalletPossessionProof(BaseModel):
    wallet_id = models.UUIDField(editable=False)
    account_id = models.UUIDField(editable=False)
    profile_id = models.UUIDField(editable=False)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    address = models.CharField(max_length=100, editable=False)
    chain = models.CharField(max_length=20, editable=False)
    challenge = models.TextField(editable=False)
    challenge_issued_at = models.DateTimeField(editable=False)
    challenge_expires_at = models.DateTimeField(editable=False)
    signature = models.TextField(editable=False)
    completed_at = models.DateTimeField(editable=False)
    digest = models.CharField(max_length=64, editable=False)

    class Meta:
        ordering = ["-completed_at", "-uuid"]
        indexes = [models.Index(fields=["wallet_id", "completed_at"])]
        constraints = [
            models.UniqueConstraint(fields=["wallet_id", "challenge"], name="one_wallet_proof_per_challenge"),
            models.CheckConstraint(
                condition=models.Q(completed_at__gte=models.F("challenge_issued_at"))
                & models.Q(completed_at__lt=models.F("challenge_expires_at")),
                name="wallet_proof_challenge_lifetime",
            ),
        ]
