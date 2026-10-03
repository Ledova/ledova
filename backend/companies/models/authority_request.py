from uuid import uuid4

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage


class CompanyCapability(models.TextChoices):
    ADMIN = "admin", "Company administration"
    PREPARE = "prepare", "Prepare register decisions"
    APPROVE = "approve", "Approve register decisions"
    APPLY = "apply", "Apply register decisions"
    FINANCE = "finance", "Company finance"
    READ_REGISTER = "read_register", "Read company register"


def authority_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/authority-requests/{instance.pk}/{uuid4()}.bin"


class CompanyAuthorityRequest(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="authority_requests")
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    requester_profile = models.ForeignKey("users.UserProfile", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()
    purpose = models.CharField(max_length=16, default="bootstrap", editable=False)
    company_identity_raw = models.JSONField(editable=False)
    company_identity = models.JSONField(editable=False)
    person_identity_raw = models.JSONField(editable=False)
    person_identity = models.JSONField(editable=False)
    requested_capabilities = models.JSONField(editable=False)
    delegatable_capabilities = models.JSONField(editable=False)
    requested_expires_at = models.DateTimeField(null=True, editable=False)
    file = models.FileField(upload_to=authority_evidence_path, storage=private_storage, max_length=255)
    original_filename = models.CharField(max_length=255, editable=False)
    file_size = models.PositiveIntegerField(editable=False)
    mime_type = models.CharField(max_length=100, editable=False)
    file_sha256 = models.CharField(max_length=64, editable=False)
    request_digest = models.CharField(max_length=64, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.UniqueConstraint(fields=["requester", "idempotency_key"], name="company_authority_request_key"),
        ]
