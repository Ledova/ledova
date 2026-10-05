import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage


def register_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-evidence/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterEvidenceKind(models.TextChoices):
    SHARE_REGISTER = "share_register", "Share register"
    ASIC_EXTRACT = "asic_extract", "ASIC extract"
    AUTHORITY = "authority", "Authority document"


class RegisterEvidence(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_evidence")
    kind = models.CharField(max_length=16, choices=RegisterEvidenceKind.choices)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()
    file = models.FileField(upload_to=register_evidence_path, storage=private_storage, max_length=255)
    original_filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField()
    mime_type = models.CharField(max_length=64)
    sha256 = models.CharField(max_length=64)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.UniqueConstraint(
                fields=["uploaded_by", "idempotency_key"], name="one_register_evidence_per_upload_key"
            ),
            models.CheckConstraint(condition=models.Q(file_size__gt=0), name="register_evidence_has_content"),
        ]
