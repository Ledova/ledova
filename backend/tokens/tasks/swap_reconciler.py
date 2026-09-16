import logging
from datetime import timedelta

from django.utils import timezone
from procrastinate import RetryStrategy

from blockchain.models import BlockchainTransaction, TransactionStatus, TransactionType
from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import SWAP_EXECUTION_RECOVERY_BATCH
from tokens.services import swap_execution

logger = logging.getLogger(__name__)

STALE_EXECUTION_AGE = timedelta(minutes=10)


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def recover_swap_execution(transaction_id: str):
    with use_operator():
        return swap_execution.recover(transaction_id)


@app.periodic(cron="*/5 * * * *")
@app.task
def resolve_executing_swaps(timestamp: int = 0):
    with use_operator():
        pending = list(
            BlockchainTransaction.objects.filter(
                tx_type=TransactionType.ATOMIC_SWAP,
                related_model="tokens.SwapOrder",
                function_args__admission__version=1,
                status__in=(TransactionStatus.PENDING, TransactionStatus.SUBMITTED),
                updated_at__lt=timezone.now() - STALE_EXECUTION_AGE,
            )
            .order_by("updated_at", "pk")
            .values_list("pk", flat=True)[:SWAP_EXECUTION_RECOVERY_BATCH]
        )
        observed = 0
        for transaction_id in pending:
            try:
                outcome = swap_execution.recover(transaction_id)
                observed += outcome in ("confirmed", "reverted", "failed")
            except Exception as exc:
                logger.warning("Swap execution %s remains held: %s", transaction_id, type(exc).__name__)
        return {"checked": len(pending), "resolved": observed}
