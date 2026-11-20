from django.db import models

from shared.models import BaseModel


class CompanyDisposal(BaseModel):
    company_id = models.UUIDField(unique=True)
    actor_id = models.BigIntegerField()
    appointment_id = models.UUIDField(null=True)
    manifest = models.JSONField()
    transaction_id = models.BigIntegerField(null=True)
    database_disposed_at = models.DateTimeField(null=True)
