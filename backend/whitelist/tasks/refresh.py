from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from whitelist.constants import WHITELIST_REMOVAL_RETRY_SECONDS
from whitelist.exceptions import WhitelistRemovalPending
from whitelist.services import refresh


@app.periodic(cron="*/5 * * * *")
@app.task
def refresh_whitelist_approvals(timestamp: int = 0):
    return refresh.sweep()


@app.task(retry=RetryStrategy(wait=WHITELIST_REMOVAL_RETRY_SECONDS, retry_exceptions=(WhitelistRemovalPending,)))
def refresh_whitelist_targets(
    targets: list,
    actor_id: str | None = None,
    remove_only: bool = False,
    cause: str | None = None,
    decision_id: str | None = None,
    invalidation_id: str | None = None,
):
    return refresh.refresh_targets(targets, cause=cause, decision_id=decision_id, invalidation_id=invalidation_id)
