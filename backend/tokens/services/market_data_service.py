from decimal import Decimal

from django.db.models import OuterRef, Subquery

from shared.db import use_operator
from tokens.models import ShareToken, SwapOrder, SwapOrderStatus, TransferOrder
from users.services.eligibility import investor_eligibility


def list_market_tokens(user):
    if not investor_eligibility(user).is_eligible:
        return ShareToken.objects.none()
    return ShareToken.objects.with_company().deployed_with_contract()


def market_summaries(tokens):
    identifiers = [token.pk for token in tokens]
    if not identifiers:
        return {}
    with use_operator():
        open_orders = TransferOrder.objects.ownership_bound().open().filter(token=OuterRef("pk"))
        last_trade = SwapOrder.objects.filter(share_token=OuterRef("pk"), status=SwapOrderStatus.COMPLETED).order_by(
            "-completed_at"
        )
        rows = (
            ShareToken.objects.filter(pk__in=identifiers)
            .annotate(
                best_bid=Subquery(open_orders.buy_orders().order_by("-price_per_share").values("price_per_share")[:1]),
                best_ask=Subquery(open_orders.sell_orders().order_by("price_per_share").values("price_per_share")[:1]),
                last_trade_payment_amount=Subquery(last_trade.values("payment_amount")[:1]),
                last_trade_share_amount=Subquery(last_trade.values("share_amount")[:1]),
                last_trade_decimals=Subquery(last_trade.values("payment_asset__decimals")[:1]),
            )
            .values(
                "pk",
                "best_bid",
                "best_ask",
                "last_trade_payment_amount",
                "last_trade_share_amount",
                "last_trade_decimals",
            )
        )
        return {
            row["pk"]: {
                "best_bid": None if row["best_bid"] is None else str(row["best_bid"].quantize(Decimal("0.01"))),
                "best_ask": None if row["best_ask"] is None else str(row["best_ask"].quantize(Decimal("0.01"))),
                "last_price": (
                    str(
                        Decimal(row["last_trade_payment_amount"])
                        / (10 ** row["last_trade_decimals"])
                        / Decimal(row["last_trade_share_amount"])
                    )
                    if row["last_trade_share_amount"] is not None
                    else None
                ),
            }
            for row in rows
        }


def get_market_data(token: ShareToken) -> dict:
    with use_operator():
        last_trade = SwapOrder.objects.last_completed_for_token(token)
        best_bid = TransferOrder.objects.best_bid(token)
        best_ask = TransferOrder.objects.best_ask(token)

        last_trade_price = None
        last_trade_data = None
        if last_trade:
            payment_full_units = Decimal(last_trade.payment_amount) / (10**last_trade.payment_asset.decimals)
            last_trade_price = payment_full_units / Decimal(last_trade.share_amount)
            last_trade_data = {
                "price": str(last_trade_price),
                "shares": last_trade.share_amount,
                "payment_amount": str(payment_full_units),
                "payment_token": last_trade.payment_asset.symbol,
                "completed_at": (last_trade.completed_at.isoformat() if last_trade.completed_at else None),
            }

        midpoint_price = (best_bid.price_per_share + best_ask.price_per_share) / 2 if best_bid and best_ask else None

        return {
            "token": str(token.uuid),
            "symbol": token.symbol,
            "lastTrade": last_trade_data,
            "lastTradePrice": str(last_trade_price) if last_trade_price else None,
            "bestBid": str(best_bid.price_per_share) if best_bid else None,
            "bestAsk": str(best_ask.price_per_share) if best_ask else None,
            "midpointPrice": str(midpoint_price) if midpoint_price else None,
        }
