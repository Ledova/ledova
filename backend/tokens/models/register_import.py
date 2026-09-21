import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import (
    RegisterCorrectionAuthority,
    RegisterCorrectionStatus,
)


def import_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-imports/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterImport(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_imports")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_imports")
    as_at = models.DateField()
    members = models.JSONField()
    former_members = models.JSONField()
    authority = models.CharField(max_length=24, choices=RegisterCorrectionAuthority.choices)
    approving_director = models.CharField(max_length=255, blank=True)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField()
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=import_evidence_path, storage=private_storage, max_length=255)
    asic_document = models.UUIDField()
    asic_fingerprint = models.CharField(max_length=64)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    asic_issued_total = models.DecimalField(max_digits=78, decimal_places=0, null=True, editable=False)
    asic_member_count = models.PositiveIntegerField(null=True, editable=False)
    register_sequence = models.PositiveBigIntegerField(null=True, editable=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.UniqueConstraint(
                fields=["token"], condition=models.Q(status="applied"), name="one_applied_register_import_per_class"
            ),
        ]


class RegisterMemberParticulars(BaseModel):
    member = models.OneToOneField("tokens.RegisterMember", on_delete=models.PROTECT, related_name="particulars")
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    source_import = models.ForeignKey(RegisterImport, on_delete=models.PROTECT, related_name="particulars")


class ImportedFormerMember(BaseModel):
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="imported_former_members")
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    shares_at_cessation = models.DecimalField(max_digits=78, decimal_places=0)
    ceased_on = models.DateField(db_index=True)
    source_import = models.ForeignKey(RegisterImport, on_delete=models.PROTECT, related_name="former_members_rows")

    class Meta:
        ordering = ["-ceased_on", "name"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(shares_at_cessation__gt=0), name="imported_former_member_positive_shares"
            ),
        ]
