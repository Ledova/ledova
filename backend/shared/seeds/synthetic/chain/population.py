from django.db.models import Q

from companies.models import Company
from shared.constants import BLOCKCHAIN_BASE
from shared.seeds.demo import DEMO_INVESTOR_EMAIL, DEMO_OWNER_EMAIL
from shared.seeds.synthetic.chain.plan import Candidate, Firm, HoldingWallet
from shared.seeds.synthetic.identities import EMAIL_DOMAIN
from shared.seeds.synthetic.story import COMPANY_SPECS, DEMO_COMPANY
from users.models import InvestorClassification, UserAccount
from users.models.investor_classification import InvestorCategory
from users.models.user_account import AccountRole
from users.services.eligibility import account_eligibility
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

COMPANY_KEYS = {spec.name: spec.key for spec in (DEMO_COMPANY, *COMPANY_SPECS)}


def companies():
    return {
        COMPANY_KEYS[company.name]: company
        for company in Company.objects.filter(name__in=COMPANY_KEYS).select_related("owner").order_by("name")
    }


def postal_address(company):
    return f"{company.address_line_1}, {company.city} {company.state} {company.postcode}"


def firms(found):
    return [
        Firm(
            key=key,
            name=company.name,
            owner=company.owner.email,
            activated_at=company.activated_at,
            address=postal_address(company),
        )
        for key, company in sorted(found.items())
    ]


def _synthetic_accounts():
    people = Q(user_profile__user__email__endswith=f"@{EMAIL_DOMAIN}") | Q(
        user_profile__user__email__in=(DEMO_INVESTOR_EMAIL, DEMO_OWNER_EMAIL)
    )
    return (
        UserAccount.objects.filter(people, user_profile__user__is_staff=False)
        .select_related("user_profile__user")
        .order_by("user_profile__user__email")
    )


def _base_wallets(account):
    wallets = Wallet.objects.filter(
        user_account=account, chain=BLOCKCHAIN_BASE, verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
    ).exclude(verified_at=None)
    return tuple(
        HoldingWallet(address=wallet.address, verified_at=wallet.verified_at)
        for wallet in sorted(wallets, key=lambda wallet: (wallet.verified_at, wallet.address))
    )


def _investor(account, wallets, active):
    eligible = frozenset(key for key, company in active.items() if account_eligibility(account, company).is_eligible)
    live = list(InvestorClassification.objects.filter(user_account=account).live().select_related("company"))
    associated = frozenset(
        key
        for key, company in active.items()
        if any(
            claim.category == InvestorCategory.ASSOCIATED_PERSON and claim.company_id == company.pk for claim in live
        )
    )
    reviewed = [claim.reviewed_at for claim in live if claim.reviewed_at]
    verified = account.user_profile.verified_at
    ready = max([verified, min(reviewed)]) if eligible and reviewed and verified else None
    return {
        "companies": eligible,
        "associated": associated,
        "ready_at": ready,
        "large_only": bool(live) and all(claim.category == InvestorCategory.PRODUCT_VALUE for claim in live),
    }


def candidates(found):
    active = {key: company for key, company in found.items() if company.can_issue_tokens}
    result = []
    for account in _synthetic_accounts():
        wallets = _base_wallets(account)
        if not wallets:
            continue
        profile = account.user_profile
        role = "company" if account.role == AccountRole.COMPANY else "investor"
        details = _investor(account, wallets, active) if role == "investor" else {}
        result.append(
            Candidate(
                key=profile.user.email,
                name=profile.full_name or profile.user.email,
                role=role,
                joined_at=profile.user.date_joined,
                wallets=wallets,
                **details,
            )
        )
    return result
