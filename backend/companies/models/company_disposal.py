from django.conf import settings
from django.db import models

from shared.models import BaseModel


class CompanyDisposal(BaseModel):
    company_id = models.UUIDField(unique=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment_id = models.UUIDField(null=True)
    manifest = models.JSONField()
    transaction_id = models.BigIntegerField(null=True)
    database_disposed_at = models.DateTimeField(null=True)
