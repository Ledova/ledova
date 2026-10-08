import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets import RegisterProposalQuerySet


def capital_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-capital-increases/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterCapitalIncrease(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey(
        "companies.Company", on_delete=models.PROTECT, related_name="register_capital_increases"
    )
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_capital_increases")
    request = models.OneToOneField(
        "tokens.CapitalIncreaseRequest", on_delete=models.PROTECT, related_name="company_instruction"
    )
    snapshot = models.JSONField(editable=False)
    intent = models.JSONField(editable=False)
    intent_digest = models.CharField(max_length=64, editable=False)
    authority_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=capital_evidence_path, storage=private_storage, max_length=255)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    approval_decision = models.ForeignKey(
        "tokens.RegisterCapitalIncreaseDecision", on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]


class RegisterCapitalIncreaseDecision(RegisterDecision):
    capital_increase = models.ForeignKey(RegisterCapitalIncrease, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_capital_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["capital_increase"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_capital_outcome",
            ),
        ]
