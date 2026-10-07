import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets import RegisterProposalQuerySet


def grant_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-grants/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterGrant(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_grants")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_grants")
    member = models.UUIDField()
    new_member = models.BooleanField()
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    shares = models.DecimalField(max_digits=78, decimal_places=0)
    effective_on = models.DateField()
    terms = models.CharField(max_length=1000)
    acceptance_required = models.BooleanField()
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    authority_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=grant_evidence_path, storage=private_storage, max_length=255)
    terms_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    terms_fingerprint = models.CharField(max_length=64)
    terms_snapshot = models.JSONField()
    terms_file = models.FileField(upload_to=grant_evidence_path, storage=private_storage, max_length=255)
    acceptance_evidence = models.ForeignKey(
        "tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True
    )
    acceptance_fingerprint = models.CharField(max_length=64, blank=True)
    acceptance_snapshot = models.JSONField(null=True)
    acceptance_file = models.FileField(
        upload_to=grant_evidence_path, storage=private_storage, max_length=255, blank=True
    )
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    register_entry = models.OneToOneField(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="grant", null=True, editable=False
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [models.CheckConstraint(condition=models.Q(shares__gt=0), name="register_grant_positive_shares")]


class RegisterGrantDecision(RegisterDecision):
    register_grant = models.ForeignKey(RegisterGrant, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_grant_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["register_grant"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_grant_outcome",
            ),
        ]
