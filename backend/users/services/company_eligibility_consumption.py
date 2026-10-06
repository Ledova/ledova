from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.services.authority_requests import _requester_principal
from shared.db import current_alias, principal_of, use_operator
from users.exceptions import InvestorNotEligibleException
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityDecisionOutcome,
    UserAccount,
)
from users.models.investor_classification import InvestorCategory
from users.services.company_eligibility import _configuration, _evidence_hash
from users.services.investor_classification import require_evidence_retention_policy

NO_LIVE_COMPANY_DECISION = "no_live_company_decision"
COMPANY_CONTEXT_REQUIRED = "company_context_required"
EXACT_PRODUCT_CONTEXT_REQUIRED = "exact_product_context_required"


@dataclass(frozen=True)
class CompanyEligibility:
    is_eligible: bool
    account: UserAccount | None
    decision: CompanyEligibilityDecision | None
    reasons: tuple[str, ...]

    @property
    def request(self):
        return self.decision.request if self.decision is not None else None


def _current(decision, account, company, purpose, offering, quantity, at, acceptance_subscription):
    with connections[current_alias()].cursor() as cursor:
        if acceptance_subscription is None:
            cursor.execute(
                "SELECT users_company_eligibility_decision_current(%s, %s, %s, %s, %s, %s, %s)",
                [decision.pk, account.pk, company.pk, purpose, offering.pk if offering else None, quantity, at],
            )
        else:
            cursor.execute(
                "SELECT offerings_subscription_eligibility_current(%s, %s, %s)",
                [acceptance_subscription.pk, decision.pk, at],
            )
        return cursor.fetchone()[0] is True


def _evaluate(
    account, company, purpose, *, offering=None, quantity=None, at=None, decision_id=None, acceptance_subscription=None
):
    if account is None or company is None:
        return CompanyEligibility(False, account, None, (COMPANY_CONTEXT_REQUIRED,))
    principal = principal_of()
    with use_operator(), _requester_principal(principal or ""):
        _configuration()
        require_evidence_retention_policy()
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT users_company_eligibility_certificate_time_zone()")
            if cursor.fetchone()[0] != settings.TIME_ZONE:
                raise ImproperlyConfigured("Certificate time-zone configuration changed; install its guard migration.")
        candidates = CompanyEligibilityDecision.objects.filter(
            request__user_account=account,
            request__company=company,
            outcome=CompanyEligibilityDecisionOutcome.ACCEPTED,
        ).select_related("request__source")
        if decision_id is not None:
            candidates = candidates.filter(pk=decision_id)
        if offering is None:
            candidates = candidates.exclude(request__category=InvestorCategory.PRODUCT_VALUE)
        if purpose == "secondary":
            candidates = candidates.filter(
                request__category__in=[InvestorCategory.ACCOUNTANT_CERTIFICATE, InvestorCategory.PROFESSIONAL_INVESTOR]
            )
        for decision in candidates.order_by("request__source_id", "request_id", "uuid"):
            try:
                evidence_hash = _evidence_hash(decision.request.source)
            except ValidationError:
                continue
            if evidence_hash != decision.request.evidence_hash:
                continue
            if _current(
                decision, account, company, purpose, offering, quantity, at or timezone.now(), acceptance_subscription
            ):
                return CompanyEligibility(True, account, decision, ())
    return CompanyEligibility(False, account, None, (NO_LIVE_COMPANY_DECISION,))


def company_eligibility(account, company, *, purpose, at=None, decision_id=None):
    if purpose not in ("primary", "secondary"):
        raise ValueError("Company eligibility requires a primary or secondary purpose.")
    return _evaluate(account, company, purpose, at=at, decision_id=decision_id)


def subscription_eligibility(account, offering, quantity, *, at=None, decision_id=None):
    if offering is None or type(quantity) is not int or not 0 < quantity <= 2147483647:
        return CompanyEligibility(False, account, None, (EXACT_PRODUCT_CONTEXT_REQUIRED,))
    return _evaluate(
        account,
        offering.company,
        "primary",
        offering=offering,
        quantity=quantity,
        at=at,
        decision_id=decision_id,
    )


def require_company_eligibility(account, company, *, purpose, at=None, decision_id=None):
    outcome = company_eligibility(account, company, purpose=purpose, at=at, decision_id=decision_id)
    if not outcome.is_eligible:
        raise InvestorNotEligibleException(outcome.reasons)
    return outcome


def require_subscription_eligibility(account, offering, quantity, *, at=None, decision_id=None):
    outcome = subscription_eligibility(account, offering, quantity, at=at, decision_id=decision_id)
    if not outcome.is_eligible:
        raise InvestorNotEligibleException(outcome.reasons)
    return outcome


def require_subscription_acceptance_eligibility(subscription, *, at=None):
    if subscription.eligibility_decision_id is None:
        raise InvestorNotEligibleException((NO_LIVE_COMPANY_DECISION,))
    outcome = _evaluate(
        subscription.user_account,
        subscription.offering.company,
        "primary",
        offering=subscription.offering,
        quantity=subscription.quantity,
        at=at,
        decision_id=subscription.eligibility_decision_id,
        acceptance_subscription=subscription,
    )
    if not outcome.is_eligible:
        raise InvestorNotEligibleException(outcome.reasons)
    return outcome
