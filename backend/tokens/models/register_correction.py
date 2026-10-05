import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_decision import RegisterDecision
from tokens.querysets import RegisterProposalQuerySet


class RegisterCorrectionAuthority(models.TextChoices):
    DIRECTOR_RESOLUTION = "director_resolution", "Director resolution"
    COURT_ORDER = "court_order", "Court order"


class RegisterCorrectionStatus(models.TextChoices):
    SUBMITTED = "submitted", "Submitted"
    APPLIED = "applied", "Applied"
    REJECTED = "rejected", "Rejected"


def correction_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-corrections/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterCorrection(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_corrections")
    register = models.ForeignKey("tokens.ShareRegister", on_delete=models.PROTECT, related_name="corrections")
    corrects = models.ForeignKey("tokens.RegisterEntry", on_delete=models.PROTECT, related_name="proposals")
    base_sequence = models.PositiveBigIntegerField()
    base_hash = models.CharField(max_length=64)
    effective_on = models.DateField()
    changes = models.JSONField()
    authority = models.CharField(max_length=24, choices=RegisterCorrectionAuthority.choices)
    approving_director = models.CharField(max_length=255, blank=True)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField(null=True)
    authority_evidence = models.ForeignKey(
        "tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True
    )
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+", null=True
    )
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=correction_evidence_path, storage=private_storage, max_length=255)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)
    applied_entry = models.OneToOneField(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="approved_correction", null=True, editable=False
    )

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    source_document__isnull=False,
                    authority_evidence__isnull=True,
                    preparing_appointment__isnull=True,
                )
                | models.Q(
                    source_document__isnull=True,
                    authority_evidence__isnull=False,
                    preparing_appointment__isnull=False,
                ),
                name="register_correction_exact_provenance",
            ),
        ]


class RegisterCorrectionDecision(RegisterDecision):
    register_correction = models.ForeignKey(RegisterCorrection, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_correction_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["register_correction"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_correction_outcome",
            ),
        ]
