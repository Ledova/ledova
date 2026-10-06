from collections import defaultdict

from companies.services.authority_requests import _requester_principal
from shared.constants import BLOCKCHAIN_BASE
from shared.db import use_operator
from shared.seeds.synthetic.chain import population as chain_population
from shared.seeds.synthetic.market.plan import Holder, Listing, Trader, TraderWallet
from tokens.models import ShareRegister, ShareToken, ShareTokenStatus
from users.models import UserAccount
from users.models.user_account import AccountRole
from users.services.company_eligibility_consumption import company_eligibility
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Holding
from whitelist.models import WhitelistApproval, WhitelistStatus


def deployed(found):
    return (
        ShareToken.objects.filter(company__in=found.values(), status=ShareTokenStatus.DEPLOYED)
        .exclude(contract_address=None)
        .exclude(contract_address="")
        .select_related("company")
        .order_by("company__name", "symbol")
    )


def share_holdings(token):
    return Holding.objects.filter(
        asset__chain_deployments__chain=BLOCKCHAIN_BASE,
        asset__chain_deployments__contract_address__iexact=token.contract_address,
        wallet__chain=BLOCKCHAIN_BASE,
    ).select_related("wallet__user_account__user_profile__user", "asset")


def listings(found):
    keys = {company.pk: key for key, company in found.items()}
    opened = set(ShareRegister.objects.filter(sequence__gt=0).values_list("token_id", flat=True))
    result = []
    for token in deployed(found):
        if token.pk not in opened:
            continue
        holders = []
        for holding in share_holdings(token).filter(
            quantity__gt=0, wallet__verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
        ):
            account = holding.wallet.user_account
            holders.append(
                Holder(
                    investor=account.user_profile.user.email,
                    address=holding.wallet.address,
                    shares=int(holding.quantity),
                    role="company" if account.role == AccountRole.COMPANY else "investor",
                )
            )
        company = keys[token.company_id]
        result.append(
            Listing(
                key=f"{company}/{token.symbol}",
                company=company,
                symbol=token.symbol,
                name=token.name,
                holders=tuple(sorted(holders, key=lambda holder: (holder.investor, holder.address.lower()))),
            )
        )
    return result


def approvals(found):
    keys = {company.pk: key for key, company in found.items()}
    approved = defaultdict(set)
    rows = WhitelistApproval.objects.filter(status=WhitelistStatus.ACTIVE, company__in=found.values()).exclude(
        entry__wallet=None
    )
    for address, company in rows.values_list("entry__wallet__address", "company_id"):
        approved[address.lower()].add(keys[company])
    return approved


def traders(found):
    approved = approvals(found)
    result = []
    for candidate in chain_population.candidates(found):
        if candidate.role != "investor" or candidate.ready_at is None or candidate.large_only:
            continue
        with use_operator():
            account = UserAccount.objects.select_related("user_profile__user").get(
                user_profile__user__email=candidate.key
            )
            with _requester_principal(account.user_profile.user_id):
                secondary = frozenset(
                    key
                    for key, company in found.items()
                    if company_eligibility(account, company, purpose="secondary").is_eligible
                )
        if not secondary:
            continue
        result.append(
            Trader(
                key=candidate.key,
                name=candidate.name,
                ready_at=candidate.ready_at,
                companies=secondary,
                associated=candidate.associated,
                wallets=tuple(
                    TraderWallet(
                        address=wallet.address,
                        verified_at=wallet.verified_at,
                        approved=frozenset(approved.get(wallet.address.lower(), ())),
                    )
                    for wallet in candidate.wallets
                ),
            )
        )
    return result
