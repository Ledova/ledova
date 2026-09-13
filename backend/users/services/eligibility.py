from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, Tuple

from operators.models import Operator
from users.constants import (
    ACCOUNT_STATUS_PENDING,
    ACCOUNT_STATUS_REJECTED,
    ACCOUNT_STATUS_SUSPENDED,
    ACCOUNT_STATUS_TERMINATED,
)
from users.exceptions import InvestorNotEligibleException
from users.models.investor_classification import (
    PRODUCT_VALUE_THRESHOLD_AUD,
    InvestorCategory,
    InvestorClassification,
)
from users.models.user_account import UserAccount

NO_INVESTOR_ACCOUNT = "no_investor_account"
NOT_AN_INVESTOR_ACCOUNT = "not_an_investor_account"
ACCOUNT_NOT_IN_GOOD_STANDING = "account_not_in_good_standing"
IDENTITY_NOT_VERIFIED = "identity_not_verified"
NO_LIVE_CLASSIFICATION = "no_live_classification"
AMOUNT_BELOW_PRODUCT_VALUE_THRESHOLD = "amount_below_product_value_threshold"

REFUSED_ACCOUNT_STATUSES = (ACCOUNT_STATUS_REJECTED, ACCOUNT_STATUS_SUSPENDED, ACCOUNT_STATUS_TERMINATED)


@dataclass(frozen=True)
class InvestorEligibility:
    is_eligible: bool
    account: Optional[UserAccount]
    classification: Optional[InvestorClassification]
    reasons: Tuple[str, ...]


def _standing_refused(account, investor_kyc_required):
    if account.account_status in REFUSED_ACCOUNT_STATUSES:
        return True
    return investor_kyc_required and account.account_status == ACCOUNT_STATUS_PENDING


def _holder_is_verified(account):
    return account.user_profile.is_id_verified


def _permits_amount(classification, amount_aud):
    if amount_aud is None or classification.category != InvestorCategory.PRODUCT_VALUE:
        return True
    return Decimal(amount_aud) >= PRODUCT_VALUE_THRESHOLD_AUD


def _evaluate(account, investor_kyc_required, company, amount_aud=None):
    reasons = []
    if _standing_refused(account, investor_kyc_required):
        reasons.append(ACCOUNT_NOT_IN_GOOD_STANDING)
    if investor_kyc_required and not _holder_is_verified(account):
        reasons.append(IDENTITY_NOT_VERIFIED)

    live = list(InvestorClassification.objects.filter(user_account=account).live().for_company(company))
    classification = next((claim for claim in live if _permits_amount(claim, amount_aud)), None)
    if classification is None:
        reasons.append(AMOUNT_BELOW_PRODUCT_VALUE_THRESHOLD if live else NO_LIVE_CLASSIFICATION)

    return InvestorEligibility(
        is_eligible=not reasons,
        account=account,
        classification=classification,
        reasons=tuple(reasons),
    )


def account_eligibility(account, company=None, amount_aud=None) -> InvestorEligibility:
    if account is None or not UserAccount.objects.investing().filter(pk=account.pk).exists():
        return InvestorEligibility(
            is_eligible=False, account=account, classification=None, reasons=(NOT_AN_INVESTOR_ACCOUNT,)
        )
    return _evaluate(account, Operator.get().investor_kyc_required, company, amount_aud)


def investor_eligibility(user, company=None) -> InvestorEligibility:
    account = UserAccount.objects.visible_to_user(user).investing().first()
    if account is None:
        return InvestorEligibility(is_eligible=False, account=None, classification=None, reasons=(NO_INVESTOR_ACCOUNT,))

    return _evaluate(account, Operator.get().investor_kyc_required, company)


def _associated_company_ids(user):
    return (
        InvestorClassification.objects.filter(user_account__in=UserAccount.objects.visible_to_user(user).investing())
        .live()
        .filter(category=InvestorCategory.ASSOCIATED_PERSON)
        .values_list("company_id", flat=True)
    )


def eligible_investor_companies(user):
    from companies.models import Company

    if investor_eligibility(user).is_eligible:
        return Company.objects.all()
    reached = [
        company.pk
        for company in Company.objects.filter(pk__in=_associated_company_ids(user))
        if investor_eligibility(user, company=company).is_eligible
    ]
    return Company.objects.filter(pk__in=reached)


def eligible_for_any_company(user) -> bool:
    return eligible_investor_companies(user).exists()


def _require(outcome) -> InvestorEligibility:
    if not outcome.is_eligible:
        raise InvestorNotEligibleException(outcome.reasons)
    return outcome


def require_investor_eligibility(user, company=None) -> InvestorEligibility:
    return _require(investor_eligibility(user, company))


def require_subscription_eligibility(account, company, amount_aud: Decimal) -> InvestorEligibility:
    return _require(account_eligibility(account, company, amount_aud))
