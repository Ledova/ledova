import logging
from datetime import timedelta

from django.utils import timezone
from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shared.db import acting_for, use_operator
from tokens.constants import DEPLOYMENT_RECOVERY_BATCH
from tokens.models import ShareToken, ShareTokenStatus, TokenDeployment
from tokens.services import deployment, swap_approval

logger = logging.getLogger(__name__)

PENDING_DEPLOYMENT_AGE = timedelta(minutes=10)


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def deploy_share_token_task(
    token_uuid: str, *, deployment_id: str, principal_id: int | None, retry_of: str | None = None
):
    with acting_for(principal_id):
        token = ShareToken.objects.select_related("company").filter(uuid=token_uuid).first()
        if token is None:
            logger.error(f"Token not found: {token_uuid}")
            return {"success": False, "error": "Token not found"}
        if token.status != ShareTokenStatus.DEPLOYING or str(token.deployment_id) != deployment_id:
            logger.warning(f"Token {token_uuid} not deployable: {token.status}")
            return {"success": False, "error": "Token is not in deploying state"}

        result = deployment.deploy_token(token, retry_of=retry_of)
        logger.info("Deployment outcome for %s: %s", token.pk, result["contract_address"] or "unresolved")
        return {"success": bool(result["contract_address"]), **result}


@app.periodic(cron="*/5 * * * *")
@app.task
def check_pending_token_deployments(timestamp: int = 0):
    pending = list(
        TokenDeployment.objects.recoverable(timezone.now() - PENDING_DEPLOYMENT_AGE).order_by("updated_at", "pk")[
            :DEPLOYMENT_RECOVERY_BATCH
        ]
    )
    checked = 0
    resolved = 0

    for command in pending:
        checked += 1
        try:
            contract_address = deployment.recover(command.pk)
        except Exception as e:
            logger.error(f"Check failed for deployment {command.pk}: {e}")
            continue
        if contract_address:
            resolved += 1
            logger.info(f"Resolved deployment {command.pk} at {contract_address}")

    logger.info(f"Pending deployments: checked={checked}, resolved={resolved}")
    return {"checked": checked, "resolved": resolved}


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def recover_swap_approval(deployment_id: str):
    with use_operator():
        return swap_approval.recover(deployment_id)


@app.periodic(cron="*/5 * * * *")
@app.task
def check_pending_swap_approvals(timestamp: int = 0):
    with use_operator():
        pending = list(
            TokenDeployment.objects.recoverable_approvals(timezone.now() - PENDING_DEPLOYMENT_AGE)
            .order_by("updated_at", "pk")
            .values_list("pk", flat=True)[:DEPLOYMENT_RECOVERY_BATCH]
        )
        resolved = 0
        for deployment_id in pending:
            try:
                if swap_approval.recover(deployment_id) in ("confirmed", "observed_approved", "failed"):
                    resolved += 1
            except Exception:
                logger.exception("Swap approval %s remains unresolved", deployment_id)
        return {"checked": len(pending), "resolved": resolved}
