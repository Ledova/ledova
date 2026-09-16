import logging
from datetime import timedelta

from django.utils import timezone
from procrastinate import RetryStrategy

from blockchain.models import BlockchainTransaction, TransactionStatus, TransactionType
from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import SWAP_EXECUTION_RECOVERY_BATCH
from tokens.models import SwapOrderStatus
from tokens.services import swap_execution

logger = logging.getLogger(__name__)

STALE_EXECUTION_AGE = timedelta(minutes=10)
RECOVERED = ("confirmed", "reverted", "failed")
SETTLED = ("completed", "failed")


@app.task(retry=RetryStrategy(max_attempts=4, wait=30))
def recover_swap_execution(transaction_id: str):
    with use_operator():
        return swap_execution.recover(transaction_id)


def _resolved(action, transaction_id, outcomes):
    try:
        return action(transaction_id) in outcomes
    except Exception as exc:
        logger.warning("Swap execution %s remains held: %s", transaction_id, type(exc).__name__)
        return False


@app.periodic(cron="*/5 * * * *")
@app.task
def resolve_executing_swaps(timestamp: int = 0):
    with use_operator():
        admitted = BlockchainTransaction.objects.filter(
            tx_type=TransactionType.ATOMIC_SWAP,
            related_model="tokens.SwapOrder",
            function_args__admission__version=1,
        ).order_by("updated_at", "pk")
        pending = list(
            admitted.filter(
                status__in=(TransactionStatus.PENDING, TransactionStatus.SUBMITTED),
                updated_at__lt=timezone.now() - STALE_EXECUTION_AGE,
            ).values_list("pk", flat=True)[:SWAP_EXECUTION_RECOVERY_BATCH]
        )
        settling = list(
            admitted.filter(
                status__in=(TransactionStatus.CONFIRMED, TransactionStatus.REVERTED),
                swap_orders__status=SwapOrderStatus.EXECUTING,
            ).values_list("pk", flat=True)[:SWAP_EXECUTION_RECOVERY_BATCH]
        )
        resolved = sum(_resolved(swap_execution.recover, transaction_id, RECOVERED) for transaction_id in pending)
        resolved += sum(_resolved(swap_execution.settle, transaction_id, SETTLED) for transaction_id in settling)
        return {"checked": len(pending) + len(settling), "resolved": resolved}
