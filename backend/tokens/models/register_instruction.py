import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.querysets import RegisterInstructionQuerySet


class RegisterInstructionKind(models.TextChoices):
    ISSUE = "issue", "Issue"
    TRANSFER = "transfer", "Transfer"


def instruction_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-instructions/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterInstruction(BaseModel):
    objects = RegisterInstructionQuerySet.as_manager()

    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_instructions")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_instructions")
    kind = models.CharField(max_length=16, choices=RegisterInstructionKind.choices)
    items = models.JSONField()
    approving_director = models.CharField(max_length=255)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField()
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=instruction_evidence_path, storage=private_storage, max_length=255)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
