import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets.register_allotment import RegisterAllotmentQuerySet


def allotment_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-allotments/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterCapitalSource(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="+")
    evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=allotment_evidence_path, storage=private_storage, max_length=255)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        abstract = True


class RegisterAgreement(RegisterCapitalSource):
    reference = models.CharField(max_length=255)
    agreed_on = models.DateField()
    terms = models.CharField(max_length=1000)


class RegisterContribution(RegisterCapitalSource):
    agreement = models.OneToOneField(RegisterAgreement, on_delete=models.PROTECT, related_name="contribution")
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    currency = models.CharField(max_length=3, default="AUD")
    received_on = models.DateField()


class RegisterAllotment(BaseModel):
    objects = RegisterAllotmentQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_allotments")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_allotments")
    agreement = models.OneToOneField(RegisterAgreement, on_delete=models.PROTECT, related_name="allotment")
    contribution = models.OneToOneField(RegisterContribution, on_delete=models.PROTECT, related_name="allotment")
    member = models.UUIDField()
    new_member = models.BooleanField()
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    shares = models.DecimalField(max_digits=78, decimal_places=0)
    company_event_on = models.DateField(null=True)
    consideration = models.DecimalField(max_digits=20, decimal_places=2)
    currency = models.CharField(max_length=3, default="AUD")
    approving_director = models.CharField(max_length=255)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    authority_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=allotment_evidence_path, storage=private_storage, max_length=255)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    register_entry = models.OneToOneField(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="allotment", null=True, editable=False
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(condition=models.Q(shares__gt=0), name="register_allotment_positive_shares")
        ]


class RegisterAllotmentDecision(RegisterDecision):
    register_allotment = models.ForeignKey(RegisterAllotment, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_allotment_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["register_allotment"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_allotment_outcome",
            ),
        ]
