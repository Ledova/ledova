from companies.models import CompanyStatus
from operators.models import Operator
from users.constants import ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING
from users.models.user_account import AccountRole

PRIVATE_REASONS = frozenset(
    {"participant_account_inactive", "participant_investor_account_required", "participant_identity_required"}
)


def participant_requirements(account, company):
    operator = Operator.configured()
    profile = account.user_profile
    actor = profile.user
    problems = []
    if (
        not actor.is_active
        or not actor.is_email_verified
        or account.account_status not in (ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING)
        or (operator.investor_kyc_required and account.account_status == ACCOUNT_STATUS_PENDING)
    ):
        problems.append("participant_account_inactive")
    if account.role not in (AccountRole.INVESTOR, AccountRole.BOTH):
        problems.append("participant_investor_account_required")
    if operator.investor_kyc_required and not profile.is_id_verified:
        problems.append("participant_identity_required")
    if company.status != CompanyStatus.ACTIVE:
        problems.append("company_inactive")
    return problems


def requirements_shown_to_the_company(requirements):
    shown = [code for code in requirements if code not in PRIVATE_REASONS]
    return [*shown, "participant_not_current"] if len(shown) < len(requirements) else shown
