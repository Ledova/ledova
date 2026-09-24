from django.contrib.auth import get_user_model
from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from whitelist.constants import WHITELIST_REMOVAL_RETRY_SECONDS
from whitelist.exceptions import WhitelistRemovalPending
from whitelist.services import refresh


@app.periodic(cron="*/5 * * * *")
@app.task
def refresh_whitelist_approvals(timestamp: int = 0):
    with use_operator():
        return refresh.sweep()


@app.task(retry=RetryStrategy(wait=WHITELIST_REMOVAL_RETRY_SECONDS, retry_exceptions=(WhitelistRemovalPending,)))
def refresh_whitelist_targets(targets: list, actor_id: str, remove_only: bool = False):
    with use_operator():
        actor = get_user_model().objects.filter(pk=actor_id).first()
        if actor is None:
            if remove_only and targets:
                raise WhitelistRemovalPending("The actor for the queued whitelist removal is unavailable.")
            return {"checked": 0, "submitted": 0, "errors": 0}
        return refresh.refresh_targets(targets, actor, remove_only)
