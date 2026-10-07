from django.conf import settings
from django.db import models

from shared.models import BaseModel
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets.register_proposal import RegisterProposalQuerySet
from whitelist.models.change import WhitelistAction
from whitelist.querysets.nomination import CompanyWalletNominationQuerySet


class CompanyWalletNomination(BaseModel):
    objects = CompanyWalletNominationQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="wallet_nominations")
    request = models.ForeignKey(
        "users.CompanyEligibilityRequest", on_delete=models.PROTECT, related_name="wallet_nominations"
    )
    decision = models.ForeignKey(
        "users.CompanyEligibilityDecision", on_delete=models.PROTECT, related_name="wallet_nominations"
    )
    proof = models.ForeignKey("wallets.WalletPossessionProof", on_delete=models.PROTECT, related_name="+")
    wallet_id = models.UUIDField(editable=False)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    snapshot = models.JSONField(editable=False)
    digest = models.CharField(max_length=64, editable=False)
    preview_digest = models.CharField(max_length=64, editable=False)
    sharing_accepted = models.BooleanField(editable=False)
    submitted_at = models.DateTimeField(editable=False)

    class Meta:
        ordering = ["-submitted_at", "-uuid"]
        constraints = [
            models.CheckConstraint(condition=models.Q(sharing_accepted=True), name="wallet_nomination_shared")
        ]


class CompanyWalletInstruction(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="wallet_instructions")
    action = models.CharField(max_length=6, choices=WhitelistAction.choices, editable=False)
    nomination = models.ForeignKey(CompanyWalletNomination, on_delete=models.PROTECT, related_name="+", null=True)
    target_change = models.ForeignKey(
        "whitelist.WhitelistChange", on_delete=models.PROTECT, related_name="+", null=True
    )
    expires_at = models.DateTimeField(null=True, editable=False)
    snapshot = models.JSONField(editable=False)
    intent = models.JSONField(editable=False)
    intent_digest = models.CharField(max_length=64, editable=False)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    approval_decision = models.ForeignKey(
        "whitelist.CompanyWalletInstructionDecision",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        editable=False,
    )
    change_id = models.UUIDField(unique=True, null=True, editable=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    action="add", nomination__isnull=False, target_change__isnull=True, expires_at__isnull=False
                )
                | models.Q(
                    action="remove", nomination__isnull=True, target_change__isnull=False, expires_at__isnull=True
                ),
                name="company_wallet_instruction_source",
            )
        ]


class CompanyWalletInstructionDecision(RegisterDecision):
    instruction = models.ForeignKey(CompanyWalletInstruction, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_company_wallet_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["instruction"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_company_wallet_outcome",
            ),
        ]
