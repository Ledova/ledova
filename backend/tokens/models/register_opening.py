import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import (
    RegisterCorrectionAuthority,
    RegisterCorrectionStatus,
)


class RegisterMemberWallet(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_wallets")
    member = models.ForeignKey("tokens.RegisterMember", on_delete=models.PROTECT, related_name="wallets")
    address = models.CharField(max_length=42)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "address"], name="register_wallet_company_address"),
        ]


def opening_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-openings/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterOpening(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_openings")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_openings")
    mapping = models.JSONField()
    boundary = models.JSONField(null=True)
    authority = models.CharField(max_length=24, choices=RegisterCorrectionAuthority.choices)
    approving_director = models.CharField(max_length=255, blank=True)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField()
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=opening_evidence_path, storage=private_storage, max_length=255)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)
    applied_entry = models.OneToOneField(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="approved_opening", null=True, editable=False
    )

    class Meta:
        ordering = ["-created_at", "-uuid"]


def link_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-links/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterWalletLink(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_wallet_links")
    mapping = models.JSONField()
    authority = models.CharField(max_length=24, choices=RegisterCorrectionAuthority.choices)
    approving_director = models.CharField(max_length=255, blank=True)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField()
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=link_evidence_path, storage=private_storage, max_length=255)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
