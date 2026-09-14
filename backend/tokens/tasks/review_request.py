import logging
from datetime import timedelta

from django.apps import apps
from django.contrib.auth import get_user_model
from django.utils import timezone
from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import CAPITAL_RECOVERY_BATCH
from tokens.exceptions import (
    CapitalIncreaseConflict,
    InvalidRecipientAddressException,
    InvalidTokenStateException,
    IssuanceRefusedException,
)
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RequestStatus,
    ShareIssuanceRequest,
)
from tokens.services import capital_execution, share_token_service

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
        request = model.objects.select_related("token", "token__company").filter(uuid=request_uuid).first()
        if request is None:
            logger.error(f"Request not found: {model_label} {request_uuid}")
            return {"success": False, "error": "Request not found"}
        user = get_user_model().objects.filter(pk=executed_by).first() if executed_by else None

        try:
            result = share_token_service.execute_request(request, executed_by=user)
        except (InvalidRecipientAddressException, InvalidTokenStateException, IssuanceRefusedException) as exc:
            logger.warning(f"Request {request_uuid} not executed: {exc.detail}")
            return {"success": False, "error": str(exc.detail)}

        return {"success": True, **result}


@app.periodic(cron="*/5 * * * *")
@app.task
def check_executing_issuance_requests(timestamp: int = 0):
    service = share_token_service
    cutoff = timezone.now() - STALE_EXECUTION_AGE
    checked = 0
    resolved = 0

    stale = ShareIssuanceRequest.objects.unresolved_on_chain(cutoff).select_related("token", "token__company")
    for request in stale:
        checked += 1
        try:
            outcome = service.resolve_executing_issuance(request)
        except Exception as e:
            logger.error(f"Check failed for executing request {request.uuid}: {e}")
            continue
        if outcome:
            resolved += 1
            logger.info(f"Request {request.uuid} {outcome} by the executing sweep")

    logger.info(f"Executing requests: checked={checked}, resolved={resolved}")
    return {"checked": checked, "resolved": resolved}


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
