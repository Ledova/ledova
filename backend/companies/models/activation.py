from django.conf import settings
from django.db import models

from shared.models import BaseModel


class CompanyActivation(BaseModel):
    company = models.OneToOneField("companies.Company", on_delete=models.PROTECT, related_name="activation_receipt")
    activated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField(editable=False)
    lifecycle_revision = models.PositiveBigIntegerField(editable=False)
    person_identity = models.JSONField(editable=False)
    issuer_identity_required = models.BooleanField(editable=False)
    declaration_version = models.CharField(max_length=10, editable=False)
    declaration_text = models.TextField(editable=False)
    activated_at = models.DateTimeField(editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["activated_by", "idempotency_key"], name="companies_one_activation_per_key")
        ]
