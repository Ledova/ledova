from collections import Counter
from contextlib import closing

from django.db import OperationalError
from django.db.models import F, Max, Min, Q

from shared.db import atomic
from tokens.events import publish_trading_event
from tokens.exceptions import OrderMatchingBusyException, SettlementChainDisagreement
from tokens.models import TransferOrder, TransferOrderStatus, TransferOrderType
from tokens.services.token_transfer_service import find_matching_orders, take_one_match
from tokens.services.trading_locks import lock_orders

MATCHED = "matched"
LISTED = "listed"
HELD = "held"
BUSY = "busy"


def _resting_status(order):
    return TransferOrderStatus.PARTIALLY_FILLED if order.filled_quantity else TransferOrderStatus.OPEN


def _has_a_match(order):
    if not TransferOrder.objects.admitted().filter(pk=order.pk).exists():
        return False
    with closing(find_matching_orders(order)) as candidates:
        return next(candidates, None) is not None


def _lock_busy(exc):
    return getattr(exc.__cause__, "sqlstate", None) == "55P03"


@atomic(durable=True)
def place_held_order(snapshot):
    locked = lock_orders(TransferOrder.objects.held().filter(pk=snapshot.pk), nowait=True)
    if not locked:
        return None
    order = locked[0]
    reopened = _has_a_match(order)
    if reopened:
        order.status = _resting_status(order)
        order.save(update_fields=["status", "updated_at"])
        match, _ = take_one_match(order)
        if match is not None:
            publish_trading_event("order_matched", str(order.token_id))
            return MATCHED
    order.rest_or_hold()
    if order.status == TransferOrderStatus.HELD:
        if reopened:
            order.save(update_fields=["status", "updated_at"])
        return HELD
    order.save(update_fields=["status", "updated_at"])
    publish_trading_event("order_listed", str(order.token_id))
    return LISTED


@atomic(durable=True)
def hold_crossing_order(snapshot):
    locked = lock_orders(TransferOrder.objects.open_or_partial().filter(pk=snapshot.pk), nowait=True)
    if not locked or not TransferOrder.objects.crossing(locked[0]).exists():
        return False
    order = locked[0]
    order.status = TransferOrderStatus.HELD
    order.save(update_fields=["status", "updated_at"])
    publish_trading_event("order_held", str(order.token_id))
    return True


def _best(book, order_type):
    if order_type == TransferOrderType.BUY:
        return book.buy_orders().order_by("-price_per_share", "created_at", "pk").first()
    return book.sell_orders().order_by("price_per_share", "created_at", "pk").first()


def _uncross(token_id, limit):
    held = 0
    while held < limit:
        book = TransferOrder.objects.advertised_liquidity().filter(token_id=token_id)
        bid, ask = _best(book, TransferOrderType.BUY), _best(book, TransferOrderType.SELL)
        if bid is None or ask is None or bid.price_per_share < ask.price_per_share:
            return held, False
        try:
            holding = hold_crossing_order(max((bid, ask), key=lambda order: (order.created_at, order.pk)))
        except OperationalError as exc:
            if not _lock_busy(exc):
                raise
            return held, True
        if not holding:
            return held, False
        held += 1
    return held, False


def _crossed_share_classes():
    return (
        TransferOrder.objects.advertised_liquidity()
        .order_by()
        .values("token_id")
        .annotate(
            best_bid=Max("price_per_share", filter=Q(order_type=TransferOrderType.BUY)),
            best_ask=Min("price_per_share", filter=Q(order_type=TransferOrderType.SELL)),
        )
        .filter(best_bid__gte=F("best_ask"))
        .values_list("token_id", flat=True)
    )


def place_held_orders(limit=500):
    outcomes = Counter()
    for snapshot in TransferOrder.objects.held().order_by("created_at", "pk")[:limit]:
        try:
            outcome = place_held_order(snapshot)
        except (OrderMatchingBusyException, SettlementChainDisagreement):
            outcome = BUSY
        except OperationalError as exc:
            if not _lock_busy(exc):
                raise
            outcome = BUSY
        outcomes[outcome] += 1
    checked = sum(outcomes.values())
    crossing = 0
    for token_id in list(_crossed_share_classes()):
        held, busy = _uncross(token_id, limit)
        crossing += held
        outcomes[BUSY] += busy
    return {
        "checked": checked,
        "matched": outcomes[MATCHED],
        "listed": outcomes[LISTED],
        "held": outcomes[HELD],
        "busy": outcomes[BUSY],
        "crossing": crossing,
    }
