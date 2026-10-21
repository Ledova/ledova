from django.conf import settings
from django.db import models

from shared.models import BaseModel
from tokens.querysets.register_member_document import RegisterMemberDocumentQuerySet


class RegisterMemberDocumentCategory(models.TextChoices):
    SHARE_CERTIFICATE = "share_certificate", "Share certificate"
    SHAREHOLDER_AGREEMENT = "shareholder_agreement", "Shareholder agreement"
    SUBSCRIPTION_AGREEMENT = "subscription_agreement", "Subscription agreement"
    OTHER = "other", "Other supporting document"


class RegisterMemberDocument(BaseModel):
    objects = RegisterMemberDocumentQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="member_documents")
    member = models.ForeignKey("tokens.RegisterMember", on_delete=models.PROTECT, related_name="documents")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="member_documents")
    source_import = models.ForeignKey(
        "tokens.RegisterImport", on_delete=models.PROTECT, related_name="member_documents", null=True
    )
    evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="member_documents")
    category = models.CharField(max_length=24, choices=RegisterMemberDocumentCategory.choices)
    snapshot = models.JSONField()
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.UniqueConstraint(fields=["recorded_by", "idempotency_key"], name="one_member_document_per_key"),
            models.UniqueConstraint(fields=["member", "token", "evidence"], name="one_member_class_document"),
        ]
