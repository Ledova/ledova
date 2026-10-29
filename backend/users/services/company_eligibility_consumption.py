from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.services.authority_requests import _requester_principal
from shared.db import current_alias, principal_of, use_operator
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityDecisionOutcome,
    UserAccount,
)
from users.services.company_eligibility import _configuration, _evidence_hash
from users.services.investor_classification import require_evidence_retention_policy

NO_LIVE_COMPANY_DECISION = "no_live_company_decision"
COMPANY_CONTEXT_REQUIRED = "company_context_required"


@dataclass(frozen=True)
class CompanyEligibility:
    is_eligible: bool
    account: UserAccount | None
    decision: CompanyEligibilityDecision | None
    reasons: tuple[str, ...]

    @property
    def request(self):
        return self.decision.request if self.decision is not None else None


def _current(decision, account, company, at):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT users_company_eligibility_decision_current(%s, %s, %s, %s)",
            [decision.pk, account.pk, company.pk, at],
        )
        return cursor.fetchone()[0] is True


def company_eligibility(account, company, *, at=None, decision_id=None):
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
        for decision in candidates.order_by("request__source_id", "request_id", "uuid"):
            try:
                evidence_hash = _evidence_hash(decision.request.source)
            except ValidationError:
                continue
            if evidence_hash != decision.request.evidence_hash:
                continue
            if _current(decision, account, company, at or timezone.now()):
                return CompanyEligibility(True, account, decision, ())
    return CompanyEligibility(False, account, None, (NO_LIVE_COMPANY_DECISION,))
