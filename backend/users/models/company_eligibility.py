from django.conf import settings
from django.db import models

from shared.constants import CURRENCY_AUD
from shared.models import BaseModel
from users.models.investor_classification import (
    PRODUCT_VALUE_THRESHOLD_AUD,
    InvestorCategory,
)


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
    offering = models.ForeignKey(
        "offerings.Offering", on_delete=models.PROTECT, related_name="eligibility_requests", null=True, editable=False
    )
    token = models.ForeignKey(
        "tokens.ShareToken", on_delete=models.PROTECT, related_name="eligibility_requests", null=True, editable=False
    )
    quantity = models.PositiveIntegerField(null=True, editable=False)
    price_per_share = models.DecimalField(max_digits=18, decimal_places=2, null=True, editable=False)
    price_currency = models.CharField(max_length=16, null=True, editable=False)
    amount_aud = models.DecimalField(max_digits=18, decimal_places=2, null=True, editable=False)
    offering_terms = models.JSONField(null=True, editable=False)
    offering_terms_digest = models.CharField(max_length=64, null=True, editable=False)

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
            models.CheckConstraint(
                condition=(
                    models.Q(
                        category=InvestorCategory.PRODUCT_VALUE,
                        offering__isnull=False,
                        token__isnull=False,
                        quantity__isnull=False,
                        quantity__gt=0,
                        price_per_share__isnull=False,
                        price_per_share__gt=0,
                        price_currency__isnull=False,
                        price_currency=CURRENCY_AUD,
                        amount_aud__isnull=False,
                        amount_aud__gte=PRODUCT_VALUE_THRESHOLD_AUD,
                        offering_terms__isnull=False,
                        offering_terms_digest__isnull=False,
                    )
                    | ~models.Q(category=InvestorCategory.PRODUCT_VALUE)
                    & models.Q(
                        offering__isnull=True,
                        token__isnull=True,
                        quantity__isnull=True,
                        price_per_share__isnull=True,
                        price_currency__isnull=True,
                        amount_aud__isnull=True,
                        offering_terms__isnull=True,
                        offering_terms_digest__isnull=True,
                    )
                ),
                name="users_eligibility_request_exact_product_scope",
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
