import logging
from datetime import timedelta

from django.utils import timezone
from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import PAUSE_RECOVERY_BATCH
from tokens.models import PauseChange
from tokens.services import pause_recovery

logger = logging.getLogger(__name__)


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def recover_pause_change(submission_id: str):
    with use_operator():
        change = pause_recovery.recover(submission_id)
        return {"completed": bool(change and change.completed_at), "status": change.status if change else None}


@app.periodic(cron="*/5 * * * *")
@app.task
def check_pending_pause_changes(timestamp: int = 0):
    with use_operator():
        pending = list(
            PauseChange.objects.recoverable(timezone.now() - timedelta(minutes=10)).values_list("pk", flat=True)[
                :PAUSE_RECOVERY_BATCH
            ]
        )
        completed = 0
        for submission_id in pending:
            try:
                change = pause_recovery.recover(submission_id)
                completed += bool(change and change.completed_at)
            except Exception:
                logger.exception("Pause submission %s remains unresolved", submission_id)
        return {"checked": len(pending), "completed": completed}
