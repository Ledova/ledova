from django.conf import settings
from django.db import models

from shared.models import BaseModel
from users.models.investor_classification import InvestorCategory


class CompanyEligibilityDecisionOutcome(models.TextChoices):
    ACCEPTED = "accepted", "Accepted by the company"
    REFUSED = "refused", "Refused by the company"


class CompanyEligibilityRequest(BaseModel):
    user_account = models.ForeignKey("users.UserAccount", on_delete=models.PROTECT, related_name="eligibility_requests")
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="eligibility_requests")
    source = models.ForeignKey(
        "users.InvestorClassification", on_delete=models.PROTECT, related_name="company_requests"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField(editable=False)
    version = models.CharField(max_length=10, default="1", editable=False)
    category = models.CharField(max_length=30, choices=InvestorCategory.choices, editable=False)
    shared_summary = models.JSONField(editable=False)
    source_fingerprint = models.CharField(max_length=64, editable=False)
    evidence_hash = models.CharField(max_length=64, editable=False)
    digest = models.CharField(max_length=64, editable=False)
    requested_expires_at = models.DateTimeField(editable=False)
    submitted_at = models.DateTimeField(editable=False)
    sharing_accepted = models.BooleanField(editable=False)
    declaration_accepted = models.BooleanField(editable=False)

    class Meta:
        ordering = ["-submitted_at", "-uuid"]
        indexes = [
            models.Index(fields=["company", "submitted_at"]),
            models.Index(fields=["user_account", "submitted_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["submitted_by", "idempotency_key"], name="users_eligibility_request_actor_key"
            ),
            models.CheckConstraint(
                condition=models.Q(sharing_accepted=True, declaration_accepted=True),
                name="users_eligibility_request_confirmations",
            ),
            models.CheckConstraint(
                condition=models.Q(requested_expires_at__gt=models.F("submitted_at")),
                name="users_eligibility_request_future_expiry",
            ),
        ]


class CompanyEligibilityDecision(BaseModel):
    request = models.OneToOneField(CompanyEligibilityRequest, on_delete=models.PROTECT, related_name="decision")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField(editable=False)
    request_digest = models.CharField(max_length=64, editable=False)
    digest = models.CharField(max_length=64, editable=False)
    outcome = models.CharField(max_length=12, choices=CompanyEligibilityDecisionOutcome.choices, editable=False)
    decided_at = models.DateTimeField(editable=False)
    expires_at = models.DateTimeField(null=True, editable=False)
    reason = models.CharField(max_length=500, blank=True, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="users_eligibility_decision_actor_key"
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        outcome=CompanyEligibilityDecisionOutcome.ACCEPTED,
                        expires_at__isnull=False,
                        expires_at__gt=models.F("decided_at"),
                        reason="",
                    )
                    | models.Q(outcome=CompanyEligibilityDecisionOutcome.REFUSED, expires_at__isnull=True)
                    & ~models.Q(reason="")
                ),
                name="users_eligibility_decision_exact_outcome",
            ),
        ]


class CompanyEligibilityRequestWithdrawal(BaseModel):
    request = models.OneToOneField(CompanyEligibilityRequest, on_delete=models.PROTECT, related_name="withdrawal")
    withdrawn_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField(editable=False)
    digest = models.CharField(max_length=64, editable=False)
    withdrawn_at = models.DateTimeField(editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["withdrawn_by", "idempotency_key"], name="users_eligibility_withdrawal_actor_key"
            )
        ]


class CompanyEligibilityRevocation(BaseModel):
    decision = models.OneToOneField(CompanyEligibilityDecision, on_delete=models.PROTECT, related_name="revocation")
    revoked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField(editable=False)
    digest = models.CharField(max_length=64, editable=False)
    reason = models.CharField(max_length=500, editable=False)
    revoked_at = models.DateTimeField(editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["revoked_by", "idempotency_key"], name="users_eligibility_revocation_actor_key"
            ),
            models.CheckConstraint(condition=~models.Q(reason=""), name="users_eligibility_revocation_reason"),
        ]
