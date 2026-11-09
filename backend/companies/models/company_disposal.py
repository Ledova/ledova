from django.db import models

from shared.models import BaseModel


class CompanyDisposal(BaseModel):
    company_id = models.UUIDField(unique=True)
    manifest = models.JSONField()
    digest = models.CharField(max_length=64)
    authorisation_reference = models.CharField(max_length=255)
    export_digest = models.CharField(max_length=64)
    handover_reference = models.CharField(max_length=255)
    purpose_review_reference = models.CharField(max_length=255)
    transaction_id = models.BigIntegerField(null=True)
    database_disposed_at = models.DateTimeField(null=True)
    pending_files = models.JSONField(default=list)
    completed_at = models.DateTimeField(null=True)
