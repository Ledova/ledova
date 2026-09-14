from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import MINT_RECOVERY_BATCH
from tokens.models import MintRequest
from tokens.services.mint_service import recover


@app.periodic(cron="*/5 * * * *")
@app.task
def recover_mint_requests(timestamp: int = 0):
    with use_operator():
        requests = list(
            MintRequest.objects.recoverable()
            .order_by("updated_at", "pk")
            .values_list("pk", flat=True)[:MINT_RECOVERY_BATCH]
        )
        outcomes = {}
        for request_id in requests:
            outcome = recover(request_id)
            outcomes[outcome] = outcomes.get(outcome, 0) + 1
        return outcomes
