import logging
from datetime import timedelta

from django.utils import timezone
from procrastinate import RetryStrategy

from compliance.constants import BATCH_MONITORING_LOOKBACK_HOURS
from ledova_backend.procrastinate_app import app
from shared.db import use_operator

logger = logging.getLogger(__name__)


@app.task(retry=RetryStrategy(max_attempts=4, wait=60))
def screen_transaction(transaction_uuid: str):
    from compliance.services.transaction_monitoring import TransactionMonitoringService

    with use_operator():
        return TransactionMonitoringService.check_recorded_transaction(transaction_uuid)


@app.periodic(cron="0 * * * *")
@app.task(
    name="compliance.tasks.run_batch_monitoring",
    retry=RetryStrategy(max_attempts=4, wait=60),
)
def run_batch_monitoring(timestamp: int) -> str:
    from compliance.models import MonitoringRule
    from compliance.services.transaction_monitoring import TransactionMonitoringService
    from users.models import UserAccount
    from wallets.models import Transaction

    if not MonitoringRule.objects.active().pattern_rules().exists():
        logger.info("[BATCH_MONITORING] No active pattern rules to check")
        return "No active pattern rules"

    recent = timezone.now() - timedelta(hours=BATCH_MONITORING_LOOKBACK_HOURS)
    active_account_uuids = (
        Transaction.objects.filter(created_at__gte=recent).values_list("wallet__user_account", flat=True).distinct()
    )

    alerts_created = accounts_checked = 0
    for account in UserAccount.objects.filter(uuid__in=active_account_uuids):
        try:
            alerts_created += len(TransactionMonitoringService.check_batch_patterns(account))
            accounts_checked += 1
        except Exception as e:
            logger.error(f"[BATCH_MONITORING] Error checking account {account.uuid}: {e}", exc_info=True)

    logger.info(f"[BATCH_MONITORING] Checked {accounts_checked} accounts, created {alerts_created} new alerts")
    return f"Checked {accounts_checked} accounts, created {alerts_created} alerts"
