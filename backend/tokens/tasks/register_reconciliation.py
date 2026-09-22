import logging

from ledova_backend.procrastinate_app import app
from tokens.models import (
    RegisterCorrectionStatus,
    RegisterReconciliationStatus,
    ShareToken,
)
from tokens.services.register_reconciliation import reconcile_register

logger = logging.getLogger(__name__)


@app.periodic(cron="50 */6 * * *")
@app.task
def reconcile_every_register(timestamp: int = 0):
    results = {status: 0 for status in RegisterReconciliationStatus.values}
    opened = ShareToken.objects.filter(register_openings__status=RegisterCorrectionStatus.APPLIED).distinct()
    for token in opened.order_by("pk"):
        try:
            record = reconcile_register(token.pk)
        except Exception as exc:
            results[RegisterReconciliationStatus.FAILED] += 1
            logger.error("Register reconciliation for share class %s raised %s", token.pk, type(exc).__name__)
            continue
        if record is not None:
            results[record.status] += 1
    if results[RegisterReconciliationStatus.FAILED]:
        raise RuntimeError(
            f"Register reconciliation failed for {results[RegisterReconciliationStatus.FAILED]} share classes."
        )
    return results
