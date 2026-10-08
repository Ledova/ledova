import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets import RegisterInstructionQuerySet


class RegisterInstructionKind(models.TextChoices):
    ISSUE = "issue", "Issue"
    TRANSFER = "transfer", "Transfer"


def instruction_evidence_path(instance, filename):
    return f"companies/{instance.company_id}/register-instructions/{instance.pk}/{uuid.uuid4()}.bin"


class RegisterInstruction(BaseModel):
    objects = RegisterInstructionQuerySet.as_manager()

    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_instructions")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_instructions")
    kind = models.CharField(max_length=16, choices=RegisterInstructionKind.choices)
    items = models.JSONField()
    approving_director = models.CharField(max_length=255)
    authority_reference = models.CharField(max_length=255)
    reason = models.CharField(max_length=1000)
    source_document = models.UUIDField(null=True)
    evidence_fingerprint = models.CharField(max_length=64)
    evidence_snapshot = models.JSONField()
    file = models.FileField(upload_to=instruction_evidence_path, storage=private_storage, max_length=255)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+", null=True
    )
    member = models.ForeignKey("tokens.RegisterMember", on_delete=models.PROTECT, related_name="+", null=True)
    nomination = models.ForeignKey(
        "whitelist.CompanyWalletNomination", on_delete=models.PROTECT, related_name="+", null=True
    )
    wallet_approval = models.ForeignKey(
        "whitelist.WhitelistChange", on_delete=models.PROTECT, related_name="+", null=True
    )
    request = models.OneToOneField(
        "tokens.ShareIssuanceRequest", on_delete=models.PROTECT, related_name="company_instruction", null=True
    )
    terms_on = models.DateField(null=True)
    terms = models.CharField(max_length=1000, null=True)
    acceptance_required = models.BooleanField(null=True)
    authority_evidence = models.ForeignKey(
        "tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True
    )
    terms_evidence = models.ForeignKey("tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True)
    terms_fingerprint = models.CharField(max_length=64, null=True)
    terms_snapshot = models.JSONField(null=True)
    terms_file = models.FileField(
        upload_to=instruction_evidence_path, storage=private_storage, max_length=255, blank=True, null=True
    )
    acceptance_evidence = models.ForeignKey(
        "tokens.RegisterEvidence", on_delete=models.PROTECT, related_name="+", null=True
    )
    acceptance_fingerprint = models.CharField(max_length=64, null=True)
    acceptance_snapshot = models.JSONField(null=True)
    acceptance_file = models.FileField(
        upload_to=instruction_evidence_path, storage=private_storage, max_length=255, blank=True, null=True
    )
    snapshot = models.JSONField(null=True, editable=False)
    intent = models.JSONField(null=True, editable=False)
    intent_digest = models.CharField(max_length=64, null=True, editable=False)
    approval_decision = models.ForeignKey(
        "tokens.RegisterInstructionDecision", on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )

    class Meta:
        ordering = ["-created_at", "-uuid"]


class RegisterInstructionDecision(RegisterDecision):
    instruction = models.ForeignKey(RegisterInstruction, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_issue_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["instruction"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_issue_outcome",
            ),
        ]
