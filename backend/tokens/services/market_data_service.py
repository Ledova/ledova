from decimal import Decimal, localcontext

from django.db.models import OuterRef, Subquery

from companies.services.authority_requests import _requester_principal
from shared.db import principal_of, use_operator
from shared.utils.token_amounts import token_full_units
from tokens.exceptions import SettlementContextChanged
from tokens.models import ShareToken, SwapOrder, TransferOrder
from users.services.eligibility import secondary_company_ids


def list_market_tokens(user):
    return ShareToken.objects.with_company().deployed_with_contract().filter(company_id__in=secondary_company_ids(user))


def _payment_decimals(protocol_version, captured_decimals, legacy_decimals):
    if protocol_version == 0:
        return legacy_decimals
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
                last_trade_decimals=Subquery(last_trade.values("payment_asset__decimals")[:1]),
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
                "last_trade_decimals",
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
                                row["last_trade_decimals"],
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
