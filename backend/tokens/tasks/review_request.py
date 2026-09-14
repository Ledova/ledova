import logging
from datetime import timedelta

from django.apps import apps
from django.utils import timezone
from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import CAPITAL_RECOVERY_BATCH, ISSUANCE_RECOVERY_BATCH
from tokens.exceptions import (
    CapitalIncreaseConflict,
    IssuanceExecutionConflict,
)
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RequestStatus,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.services import capital_execution, issuance_execution, legacy_issuance

logger = logging.getLogger(__name__)

STALE_EXECUTION_AGE = timedelta(minutes=10)


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def execute_review_request_task(
    model_label: str, request_uuid: str, executed_by: int | None = None, execution_id: str | None = None
):
    with use_operator():
        model = apps.get_model(model_label)
        if model is CapitalIncreaseRequest:
            execution = CapitalIncreaseExecution.objects.filter(
                pk=execution_id, request_id=request_uuid, executed_by_id=executed_by
            ).first()
            if execution is None:
                return {"success": False, "error": "Capital execution has no matching admitted identity"}
            try:
                result = capital_execution.recover(execution.pk)
            except CapitalIncreaseConflict as exc:
                logger.warning("Capital execution %s needs recovery", execution.pk)
                return {"success": False, "error": str(exc.detail)}
            return {"success": result["status"] == RequestStatus.EXECUTED, **result}
        if model is not ShareIssuanceRequest:
            return {"success": False, "error": "Unsupported review request"}
        execution = ShareIssuanceExecution.objects.filter(
            pk=execution_id, request_id=request_uuid, executed_by_id=executed_by, subscription_id__isnull=True
        ).first()
        if execution is None:
            return {"success": False, "error": "Issuance has no matching admitted identity"}
        try:
            result = issuance_execution.recover(execution.pk)
        except IssuanceExecutionConflict as exc:
            logger.warning("Issuance execution %s needs recovery", execution.pk)
            return {"success": False, "error": str(exc.detail)}
        return {"success": result["status"] == RequestStatus.EXECUTED, **result}


@app.periodic(cron="*/5 * * * *")
@app.task
def check_executing_issuance_requests(timestamp: int = 0):
    with use_operator():
        cutoff = timezone.now() - STALE_EXECUTION_AGE
        pending = list(
            ShareIssuanceExecution.objects.recoverable(cutoff)
            .order_by("updated_at", "pk")
            .values_list("pk", flat=True)[:ISSUANCE_RECOVERY_BATCH]
        )
        resolved = 0
        for execution_id in pending:
            ShareIssuanceExecution.objects.filter(pk=execution_id).update(updated_at=timezone.now())
            try:
                result = issuance_execution.recover(execution_id)
                resolved += result["status"] in (RequestStatus.EXECUTED, RequestStatus.FAILED, RequestStatus.REJECTED)
            except Exception:
                logger.warning("Issuance execution %s remains unresolved", execution_id)
        legacy = list(
            ShareIssuanceRequest.objects.unresolved_on_chain(cutoff)
            .filter(dispatch_id__isnull=True)
            .order_by("updated_at", "pk")[:ISSUANCE_RECOVERY_BATCH]
        )
        for request in legacy:
            ShareIssuanceRequest.objects.filter(pk=request.pk).update(updated_at=timezone.now())
            try:
                resolved += bool(legacy_issuance.resolve_executing_issuance(request))
            except Exception:
                logger.warning("Historical issuance %s remains unresolved", request.pk)
        return {"checked": len(pending) + len(legacy), "resolved": resolved}


@app.periodic(cron="*/5 * * * *")
@app.task
def recover_capital_increases(timestamp: int = 0):
    with use_operator():
        pending = list(
            CapitalIncreaseExecution.objects.recoverable(timezone.now() - STALE_EXECUTION_AGE)
            .order_by("updated_at", "pk")
            .values_list("pk", flat=True)[:CAPITAL_RECOVERY_BATCH]
        )
        resolved = 0
        for execution_id in pending:
            CapitalIncreaseExecution.objects.filter(pk=execution_id).update(updated_at=timezone.now())
            try:
                result = capital_execution.recover(execution_id)
            except Exception:
                logger.warning("Capital execution %s remains unresolved", execution_id)
                continue
            resolved += result["status"] in (RequestStatus.EXECUTED, RequestStatus.FAILED, RequestStatus.SUPERSEDED)
        return {"checked": len(pending), "resolved": resolved}
