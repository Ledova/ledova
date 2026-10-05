import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import (
    RegisterCorrectionAuthority,
    RegisterCorrectionStatus,
)
from tokens.querysets import RegisterProposalQuerySet


def import_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-imports/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterImport(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_imports")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_imports")
    as_at = models.DateField()
    members = models.JSONField()
    former_members = models.JSONField()
    authority = models.CharField(max_length=24, choices=RegisterCorrectionAuthority.choices)
    approving_director = models.CharField(max_length=255, blank=True)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField(null=True)
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=import_evidence_path, storage=private_storage, max_length=255)
    asic_document = models.UUIDField(null=True)
    asic_fingerprint = models.CharField(max_length=64)
    asic_snapshot = models.JSONField(null=True)
    asic_file = models.FileField(upload_to=import_evidence_path, storage=private_storage, max_length=255, blank=True)
    register_evidence = models.ForeignKey(
        "tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True
    )
    asic_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+", null=True
    )
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
            models.CheckConstraint(
                condition=(
                    models.Q(
                        preparing_appointment__isnull=True,
                        register_evidence__isnull=True,
                        asic_evidence__isnull=True,
                        asic_snapshot__isnull=True,
                        asic_file="",
                        source_document__isnull=False,
                        asic_document__isnull=False,
                    )
                    | (
                        models.Q(
                            preparing_appointment__isnull=False,
                            register_evidence__isnull=False,
                            asic_evidence__isnull=False,
                            asic_snapshot__isnull=False,
                            asic_issued_total__isnull=False,
                            asic_member_count__isnull=False,
                            source_document__isnull=True,
                            asic_document__isnull=True,
                        )
                        & ~models.Q(asic_file="")
                    )
                ),
                name="register_import_exact_provenance",
            ),
        ]


class RegisterImportDecisionKind(models.TextChoices):
    APPROVE = "approve", "Approve"
    APPLY = "apply", "Apply"
    REJECT = "reject", "Reject"


class RegisterImportDecision(BaseModel):
    register_import = models.ForeignKey(RegisterImport, on_delete=models.PROTECT, related_name="decisions")
    kind = models.CharField(max_length=8, choices=RegisterImportDecisionKind.choices)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()
    digest = models.CharField(max_length=64)
    reason = models.CharField(max_length=1000, blank=True)
    decided_at = models.DateTimeField()

    class Meta:
        ordering = ["decided_at", "uuid"]
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_import_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["register_import"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_import_outcome",
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
