from collections import Counter
from contextlib import closing

from django.db import OperationalError

from shared.db import atomic
from tokens.events import publish_trading_event
from tokens.exceptions import OrderMatchingBusyException, SettlementChainDisagreement
from tokens.models import TransferOrder, TransferOrderStatus
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


def place_held_orders(limit=500):
    outcomes = Counter()
    for snapshot in TransferOrder.objects.held().order_by("created_at", "pk")[:limit]:
        try:
            outcome = place_held_order(snapshot)
        except (OrderMatchingBusyException, SettlementChainDisagreement):
            outcome = BUSY
        except OperationalError as exc:
            if getattr(exc.__cause__, "sqlstate", None) != "55P03":
                raise
            outcome = BUSY
        outcomes[outcome] += 1
    return {
        "checked": sum(outcomes.values()),
        "matched": outcomes[MATCHED],
        "listed": outcomes[LISTED],
        "held": outcomes[HELD],
        "busy": outcomes[BUSY],
    }
