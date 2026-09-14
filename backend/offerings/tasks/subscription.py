import logging

from django.utils import timezone
from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from offerings.models import Subscription
from offerings.services.subscription import (
    executed_requests_pending_allotment,
    expire_overdue,
)
from shared.db import use_operator
from tokens.exceptions import IssuanceExecutionConflict
from tokens.models import RequestStatus, ShareIssuanceExecution
from tokens.services import issuance_execution

logger = logging.getLogger(__name__)

SWEEP_BATCH = 200


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def allot_subscription_task(subscription_uuid: str, executed_by: int | None = None, execution_id: str | None = None):
    with use_operator():
        execution = ShareIssuanceExecution.objects.filter(
            pk=execution_id, subscription_id=subscription_uuid, executed_by_id=executed_by
        ).first()
        if execution is None:
            return {"success": False, "error": "Allotment has no matching admitted issuance identity"}
        try:
            result = issuance_execution.recover(execution.pk)
        except IssuanceExecutionConflict as exc:
            logger.warning("Subscription %s requires issuance recovery", subscription_uuid)
            return {"success": False, "error": str(exc.detail)}
        return {"success": result["status"] == RequestStatus.EXECUTED, **result}


def _mirror_allotted(subscription: Subscription) -> bool:
    from offerings.models import SubscriptionStatus

    if subscription.status != SubscriptionStatus.PAID:
        return False
    subscription.mark_allotted()
    return True


@app.periodic(cron="*/5 * * * *")
@app.task
def reconcile_subscriptions(timestamp: int = 0):
    flipped = 0
    for subscription in executed_requests_pending_allotment()[:SWEEP_BATCH]:
        if _mirror_allotted(subscription):
            flipped += 1
            logger.info(f"Subscription {subscription.uuid} mirrored to allotted from an executed request")
    logger.info(f"Subscriptions reconciled: flipped={flipped}")
    return {"flipped": flipped}


@app.periodic(cron="0 3 * * *")
@app.task
def expire_unpaid_subscriptions(timestamp: int = 0):
    result = expire_overdue(timezone.now(), SWEEP_BATCH)
    logger.info(f"Unpaid subscriptions expired: {result['expired']}, left for an operator: {result['left_alone']}")
    return result
