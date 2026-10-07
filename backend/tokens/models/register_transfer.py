import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets import RegisterProposalQuerySet


def transfer_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-transfers/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterTransfer(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_transfers")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_transfers")
    from_member = models.UUIDField()
    to_member = models.UUIDField()
    new_member = models.BooleanField()
    new_particulars = models.BooleanField()
    from_name = models.CharField(max_length=255)
    from_residential_address = models.TextField()
    from_particulars = models.JSONField()
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    to_particulars = models.JSONField(null=True)
    shares = models.DecimalField(max_digits=78, decimal_places=0)
    signed_on = models.DateField()
    lodged_on = models.DateField()
    terms = models.CharField(max_length=1000)
    authority = models.CharField(max_length=24, default="director_resolution")
    approving_director = models.CharField(max_length=255)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    authority_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=transfer_evidence_path, storage=private_storage, max_length=255)
    instrument_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+")
    instrument_fingerprint = models.CharField(max_length=64)
    instrument_snapshot = models.JSONField()
    instrument_file = models.FileField(upload_to=transfer_evidence_path, storage=private_storage, max_length=255)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    register_entry = models.OneToOneField(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="direct_transfer", null=True, editable=False
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(condition=models.Q(shares__gt=0), name="register_transfer_positive_shares"),
            models.CheckConstraint(
                condition=~models.Q(from_member=models.F("to_member")), name="register_transfer_distinct_members"
            ),
        ]


class RegisterTransferDecision(RegisterDecision):
    register_transfer = models.ForeignKey(RegisterTransfer, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_transfer_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["register_transfer"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_transfer_outcome",
            ),
        ]


class RegisterMemberCessation(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="member_cessations")
    register = models.ForeignKey("tokens.ShareRegister", on_delete=models.PROTECT, related_name="member_cessations")
    member = models.ForeignKey("tokens.RegisterMember", on_delete=models.PROTECT, related_name="cessations")
    entry = models.ForeignKey("tokens.RegisterEntry", on_delete=models.PROTECT, related_name="member_cessations")
    ceased_on = models.DateField(db_index=True)
    shares_at_cessation = models.DecimalField(max_digits=78, decimal_places=0)
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    identity_source = models.CharField(max_length=20, default="particulars")
    particulars_snapshot = models.JSONField()
    returned_entry = models.ForeignKey(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="member_returns", null=True
    )
    returned_on = models.DateField(null=True)
    returned_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-ceased_on", "-entry__sequence", "member_id"]
        constraints = [
            models.UniqueConstraint(fields=["member", "entry"], name="one_member_cessation_per_entry"),
            models.CheckConstraint(
                condition=models.Q(shares_at_cessation__gt=0), name="register_cessation_positive_shares"
            ),
        ]
