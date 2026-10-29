from companies.services.authority_requests import _requester_principal
from shared.db import principal_of, use_operator
from users.constants import (
    ACCOUNT_STATUS_REJECTED,
    ACCOUNT_STATUS_SUSPENDED,
    ACCOUNT_STATUS_TERMINATED,
)
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityDecisionOutcome,
    UserAccount,
)
from users.services.company_eligibility_consumption import company_eligibility

REFUSED_ACCOUNT_STATUSES = (ACCOUNT_STATUS_REJECTED, ACCOUNT_STATUS_SUSPENDED, ACCOUNT_STATUS_TERMINATED)


def secondary_company_ids(user):
    principal = principal_of()
    if user is None or not user.is_authenticated or principal != str(user.pk):
        return frozenset()
    company_ids, evaluated = set(), set()
    with use_operator(), _requester_principal(principal):
        accounts = list(UserAccount.objects.for_holder(user).investing().order_by("uuid"))
        decisions = (
            CompanyEligibilityDecision.objects.filter(
                request__user_account__in=accounts, outcome=CompanyEligibilityDecisionOutcome.ACCEPTED
            )
            .select_related("request__user_account", "request__company")
            .order_by("request__user_account_id", "request__company_id", "uuid")
        )
        for decision in decisions:
            request = decision.request
            pair = (request.user_account_id, request.company_id)
            if pair in evaluated:
                continue
            evaluated.add(pair)
            if company_eligibility(request.user_account, request.company).is_eligible:
                company_ids.add(request.company_id)
    return frozenset(company_ids)
