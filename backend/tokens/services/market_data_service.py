from decimal import Decimal, localcontext

from django.db.models import OuterRef, Subquery

from companies.services.authority_requests import _requester_principal
from shared.db import principal_of, use_operator
from shared.utils.token_amounts import token_full_units
from tokens.exceptions import SettlementContextChanged
from tokens.models import ShareToken, SwapOrder, TransferOrder
from users.models import UserAccount
from users.services.participants import participant_requirements
from whitelist.models import WhitelistApproval


def market_company_ids(user):
    principal = principal_of()
    if user is None or not user.is_authenticated or principal != str(user.pk):
        return frozenset()
    with use_operator(), _requester_principal(principal):
        approvals = (
            WhitelistApproval.objects.live()
            .filter(entry__wallet__user_account__in=UserAccount.objects.for_holder(user).investing())
            .select_related("company", "entry__wallet__user_account__user_profile__user")
            .order_by("company_id", "uuid")
        )
        return frozenset(
            approval.company_id
            for approval in approvals
            if not participant_requirements(approval.entry.wallet.user_account, approval.company)
        )


def list_market_tokens(user):
    return ShareToken.objects.with_company().deployed_with_contract().filter(company_id__in=market_company_ids(user))


def _payment_decimals(protocol_version, captured_decimals):
    if protocol_version != 1 or type(captured_decimals) is not int or not 0 <= captured_decimals <= 255:
        raise SettlementContextChanged()
    return captured_decimals


def market_summaries(tokens):
    identifiers = [token.pk for token in tokens]
    if not identifiers:
        return {}
    principal = principal_of()
    with use_operator(), _requester_principal(principal or ""), localcontext() as context:
        context.prec = 28
        open_orders = TransferOrder.objects.advertised_liquidity().filter(token=OuterRef("pk"))
        last_trade = SwapOrder.objects.completed_for_token(OuterRef("pk"))
        rows = (
            ShareToken.objects.filter(pk__in=identifiers)
            .annotate(
                best_bid=Subquery(open_orders.buy_orders().order_by("-price_per_share").values("price_per_share")[:1]),
                best_ask=Subquery(open_orders.sell_orders().order_by("price_per_share").values("price_per_share")[:1]),
                last_trade_payment_amount=Subquery(last_trade.values("payment_amount")[:1]),
                last_trade_share_amount=Subquery(last_trade.values("share_amount")[:1]),
                last_trade_protocol=Subquery(last_trade.values("settlement_protocol_version")[:1]),
                last_trade_deployment_decimals=Subquery(
                    last_trade.values("settlement_context__payment_asset__deployment_decimals")[:1]
                ),
            )
            .values(
                "pk",
                "best_bid",
                "best_ask",
                "last_trade_payment_amount",
                "last_trade_share_amount",
                "last_trade_protocol",
                "last_trade_deployment_decimals",
            )
        )
        return {
            row["pk"]: {
                "best_bid": None if row["best_bid"] is None else str(row["best_bid"].quantize(Decimal("0.01"))),
                "best_ask": None if row["best_ask"] is None else str(row["best_ask"].quantize(Decimal("0.01"))),
                "last_price": (
                    str(
                        token_full_units(
                            row["last_trade_payment_amount"],
                            _payment_decimals(
                                row["last_trade_protocol"],
                                row["last_trade_deployment_decimals"],
                            ),
                        )
                        / Decimal(row["last_trade_share_amount"])
                    )
                    if row["last_trade_share_amount"] is not None
                    else None
                ),
            }
            for row in rows
        }
