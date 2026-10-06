from dataclasses import dataclass

from companies.services.authority_requests import _requester_principal
from shared.db import principal_of, use_operator
from users.constants import (
    ACCOUNT_STATUS_ACTIVE,
    ACCOUNT_STATUS_PENDING,
    ACCOUNT_STATUS_REJECTED,
    ACCOUNT_STATUS_SUSPENDED,
    ACCOUNT_STATUS_TERMINATED,
)
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityDecisionOutcome,
    UserAccount,
)
from users.models.investor_classification import InvestorCategory
from users.services.company_eligibility import _configuration
from users.services.company_eligibility_consumption import (
    company_eligibility,
    subscription_eligibility,
)

NO_INVESTOR_ACCOUNT = "no_investor_account"
ACCOUNT_NOT_IN_GOOD_STANDING = "account_not_in_good_standing"
IDENTITY_NOT_VERIFIED = "identity_not_verified"
ACTOR_NOT_READY = "actor_not_ready"
PRINCIPAL_REQUIRED = "principal_required"

REFUSED_ACCOUNT_STATUSES = (ACCOUNT_STATUS_REJECTED, ACCOUNT_STATUS_SUSPENDED, ACCOUNT_STATUS_TERMINATED)
SECONDARY_CATEGORIES = (InvestorCategory.ACCOUNTANT_CERTIFICATE, InvestorCategory.PROFESSIONAL_INVESTOR)


@dataclass(frozen=True)
class InvestorReadiness:
    is_ready: bool
    account: UserAccount | None
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class DirectoryAdmission:
    company_ids: frozenset
    offering_ids: frozenset
    token_ids: frozenset


def _actual_principal(user):
    principal = principal_of()
    if user is None or not user.is_authenticated or principal != str(user.pk):
        return None
    return principal


def _owned_accounts(user):
    return list(UserAccount.objects.for_holder(user).investing().select_related("user_profile__user").order_by("uuid"))


def _readiness(account, investor_kyc_required):
    reasons = []
    actor = account.user_profile.user
    if not actor.is_active or not actor.is_email_verified:
        reasons.append(ACTOR_NOT_READY)
    allowed_statuses = (
        (ACCOUNT_STATUS_ACTIVE,) if investor_kyc_required else (ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING)
    )
    if account.account_status not in allowed_statuses:
        reasons.append(ACCOUNT_NOT_IN_GOOD_STANDING)
    if investor_kyc_required and not account.user_profile.is_id_verified:
        reasons.append(IDENTITY_NOT_VERIFIED)
    return InvestorReadiness(not reasons, account, tuple(reasons))


def investor_readiness(user):
    principal = _actual_principal(user)
    if principal is None:
        return InvestorReadiness(False, None, (PRINCIPAL_REQUIRED,))
    with use_operator(), _requester_principal(principal):
        configuration = _configuration()
        accounts = _owned_accounts(user)
        if not accounts:
            return InvestorReadiness(False, None, (NO_INVESTOR_ACCOUNT,))
        outcomes = [_readiness(account, configuration.investor_kyc_required) for account in accounts]
        return next((outcome for outcome in outcomes if outcome.is_ready), outcomes[0])


def _decisions(accounts):
    return (
        CompanyEligibilityDecision.objects.filter(
            request__user_account__in=accounts, outcome=CompanyEligibilityDecisionOutcome.ACCEPTED
        )
        .select_related("request__user_account", "request__company", "request__offering__token__company")
        .order_by("request__user_account_id", "request__company_id", "uuid")
    )


def directory_admission(user):
    principal = _actual_principal(user)
    if principal is None:
        return DirectoryAdmission(frozenset(), frozenset(), frozenset())
    company_ids, offering_ids, token_ids, evaluated = set(), set(), set(), set()
    with use_operator(), _requester_principal(principal):
        for decision in _decisions(_owned_accounts(user)):
            request = decision.request
            if request.category == InvestorCategory.PRODUCT_VALUE:
                outcome = subscription_eligibility(
                    request.user_account, request.offering, request.quantity, decision_id=decision.pk
                )
                if outcome.is_eligible:
                    offering_ids.add(request.offering_id)
                    token_ids.add(request.token_id)
                continue
            pair = (request.user_account_id, request.company_id)
            if pair in evaluated:
                continue
            evaluated.add(pair)
            if company_eligibility(request.user_account, request.company, purpose="primary").is_eligible:
                company_ids.add(request.company_id)
    return DirectoryAdmission(frozenset(company_ids), frozenset(offering_ids), frozenset(token_ids))


def secondary_company_ids(user):
    principal = _actual_principal(user)
    if principal is None:
        return frozenset()
    company_ids, evaluated = set(), set()
    with use_operator(), _requester_principal(principal):
        for decision in _decisions(_owned_accounts(user)).filter(request__category__in=SECONDARY_CATEGORIES):
            request = decision.request
            pair = (request.user_account_id, request.company_id)
            if pair in evaluated:
                continue
            evaluated.add(pair)
            if company_eligibility(request.user_account, request.company, purpose="secondary").is_eligible:
                company_ids.add(request.company_id)
    return frozenset(company_ids)
