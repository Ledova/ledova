import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.querysets.register_award import RegisterAwardQuerySet


def award_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-awards/{instance.pk}/{uuid.uuid4()}.bin"


def award_vesting_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-award-vestings/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterAward(BaseModel):
    objects = RegisterAwardQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_awards")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_awards")
    member = models.UUIDField()
    new_member = models.BooleanField()
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    shares = models.DecimalField(max_digits=78, decimal_places=0)
    terms_on = models.DateField()
    terms = models.CharField(max_length=1000)
    schedule = models.CharField(max_length=1000)
    agreement_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    agreement_fingerprint = models.CharField(max_length=64)
    agreement_snapshot = models.JSONField()
    file = models.FileField(upload_to=award_evidence_path, storage=private_storage, max_length=255)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [models.CheckConstraint(condition=models.Q(shares__gt=0), name="register_award_positive_shares")]


class RegisterAwardVesting(BaseModel):
    objects = RegisterAwardQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_award_vestings")
    award = models.ForeignKey(RegisterAward, on_delete=models.PROTECT, related_name="vestings")
    shares = models.DecimalField(max_digits=78, decimal_places=0)
    vested_on = models.DateField()
    evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=award_vesting_evidence_path, storage=private_storage, max_length=255)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-vested_on", "-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(condition=models.Q(shares__gt=0), name="register_award_vesting_positive_shares")
        ]
