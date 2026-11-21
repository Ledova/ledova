import logging
from datetime import timedelta
from decimal import Decimal
from typing import Dict, List, Tuple

from django.db.models import Avg, Sum
from django.utils import timezone

from compliance.constants import (
    AGGREGATE_VOLUME_PERIOD_DAYS,
    AGGREGATE_VOLUME_THRESHOLD_AUD,
    ALERT_STATUS_NEW,
    ALERT_STATUS_REVIEWING,
    ALERT_THRESHOLD_AUD,
    ALERT_TYPE_DORMANT_REACTIVATION,
    ALERT_TYPE_HIGH_AGGREGATE_VOLUME,
    ALERT_TYPE_LARGE_TRANSACTION,
    ALERT_TYPE_NEW_CUSTOMER_SOF,
    ALERT_TYPE_PATTERN_DEVIATION,
    ALERT_TYPE_RAPID_TRANSACTIONS,
    ALERT_TYPE_ROUND_AMOUNTS,
    ALERT_TYPE_STRUCTURING,
    DORMANT_ACCOUNT_DAYS,
    NEW_CUSTOMER_DAYS,
    PATTERN_DEVIATION_BASELINE_DAYS,
    PATTERN_DEVIATION_MIN_HISTORY,
    PATTERN_DEVIATION_MULTIPLIER,
    ROUND_AMOUNT_COUNT_THRESHOLD,
    ROUND_AMOUNT_DIVISOR,
    ROUND_AMOUNT_PERIOD_DAYS,
    RULE_TYPE_AGGREGATE_VOLUME,
    RULE_TYPE_DORMANT_REACTIVATION,
    RULE_TYPE_PATTERN,
    RULE_TYPE_PATTERN_DEVIATION,
    RULE_TYPE_RAPID_TRANSACTIONS,
    RULE_TYPE_ROUND_AMOUNTS,
    RULE_TYPE_SOF_REQUIRED,
    RULE_TYPE_THRESHOLD,
    SCREENING_THRESHOLD_AUD,
    TRANSACTION_MONITORING_WINDOW_HOURS,
)
from compliance.models import ComplianceAlert, MonitoringRule
from shared.db import atomic
from shared.tasks.queue import defer
from users.services.accounts import lock_active_profile
from wallets.models import Transaction

logger = logging.getLogger(__name__)

RULE_CODE_TO_ALERT_TYPE = {
    "MON-001": ALERT_TYPE_LARGE_TRANSACTION,
    "MON-002": ALERT_TYPE_RAPID_TRANSACTIONS,
    "MON-003": ALERT_TYPE_STRUCTURING,
    "MON-006": ALERT_TYPE_NEW_CUSTOMER_SOF,
    "MON-007": ALERT_TYPE_HIGH_AGGREGATE_VOLUME,
    "MON-008": ALERT_TYPE_DORMANT_REACTIVATION,
    "MON-009": ALERT_TYPE_PATTERN_DEVIATION,
    "MON-010": ALERT_TYPE_ROUND_AMOUNTS,
}

RuleResult = Tuple[bool, Dict]


def is_new_customer(user_account, days: int = NEW_CUSTOMER_DAYS) -> bool:
    started = user_account.activation_date or user_account.created_at
    return started > timezone.now() - timedelta(days=days)


def _aud_value(transaction) -> Decimal:
    return transaction.market_value_aud or Decimal("0")


def _has_sof_documentation(user_account) -> bool:
    holder = user_account.user_profile
    financial_profile = getattr(holder, "financial_profile", None)
    sof = financial_profile.source_of_funds if financial_profile else None
    return bool(sof) and sof != "other" and sof != ["other"]


def _check_threshold(rule, transaction, user_account) -> RuleResult:
    if transaction is None:
        return False, {}
    threshold = Decimal(str(rule.parameters.get("amount", ALERT_THRESHOLD_AUD)))
    amount = _aud_value(transaction)
    if amount < threshold:
        return False, {}
    return True, {
        "amount": float(amount),
        "threshold": float(threshold),
        "currency": rule.parameters.get("currency", "AUD"),
    }


def _check_rapid_transactions(rule, transaction, user_account) -> RuleResult:
    max_transactions = rule.parameters.get("max_transactions", 5)
    period_minutes = rule.parameters.get("period_minutes", 60)
    count = (
        Transaction.objects.filter(wallet__user_account=user_account)
        .happened_since(timezone.now() - timedelta(minutes=period_minutes))
        .count()
    )
    if count < max_transactions:
        return False, {}
    return True, {
        "transaction_count": count,
        "threshold": max_transactions,
        "period_minutes": period_minutes,
        "reason": f"{count} transactions in {period_minutes} minutes",
    }


def _check_structuring_pattern(rule, transaction, user_account) -> RuleResult:
    params = rule.parameters
    min_transactions = params.get("min_transactions", 3)
    max_each = Decimal(str(params.get("max_each", 9999)))
    min_each = Decimal(str(params.get("min_each", 8000)))
    period_hours = params.get("period_hours", 168)
    count = (
        Transaction.objects.filter(
            wallet__user_account=user_account, market_value_aud__gte=min_each, market_value_aud__lte=max_each
        )
        .happened_since(timezone.now() - timedelta(hours=period_hours))
        .count()
    )
    if count < min_transactions:
        return False, {}
    return True, {
        "transaction_count": count,
        "min_required": min_transactions,
        "amount_range": f"${float(min_each):,.0f} - ${float(max_each):,.0f}",
        "period_hours": period_hours,
        "pattern": "potential_structuring",
    }


def _check_sof_required(rule, transaction, user_account) -> RuleResult:
    if transaction is None:
        return False, {}
    threshold = Decimal(str(rule.parameters.get("amount", ALERT_THRESHOLD_AUD)))
    customer_age_days = rule.parameters.get("customer_age_days", 30)
    amount = _aud_value(transaction)
    if not is_new_customer(user_account, days=customer_age_days) or amount < threshold:
        return False, {}
    if _has_sof_documentation(user_account):
        return False, {}
    return True, {
        "amount": float(amount),
        "threshold": float(threshold),
        "has_sof_documentation": False,
        "customer_age_days": customer_age_days,
        "reason": "High-value transaction by new customer without SOF documentation",
        "action_required": "Request source of funds documentation",
    }


def _check_aggregate_volume(rule, transaction, user_account) -> RuleResult:
    threshold = Decimal(str(rule.parameters.get("amount", AGGREGATE_VOLUME_THRESHOLD_AUD)))
    period_days = rule.parameters.get("period_days", AGGREGATE_VOLUME_PERIOD_DAYS)
    period_start = timezone.now() - timedelta(days=period_days)
    total_volume = Transaction.objects.filter(
        wallet__user_account=user_account, market_value_aud__isnull=False
    ).happened_since(period_start).aggregate(total=Sum("market_value_aud"))["total"] or Decimal("0")
    if total_volume < threshold:
        return False, {}
    return True, {
        "total_volume": float(total_volume),
        "threshold": float(threshold),
        "period_days": period_days,
        "reason": f"High aggregate volume: ${float(total_volume):,.2f} in {period_days} days",
    }


def _check_dormant_reactivation(rule, transaction, user_account) -> RuleResult:
    if transaction is None:
        return False, {}
    dormant_days = rule.parameters.get("dormant_days", DORMANT_ACCOUNT_DAYS)
    min_amount = Decimal(str(rule.parameters.get("min_amount", SCREENING_THRESHOLD_AUD)))
    amount = _aud_value(transaction)
    if amount < min_amount:
        return False, {}
    happened = transaction.block_timestamp or transaction.created_at
    previous = (
        Transaction.objects.filter(wallet__user_account=user_account)
        .exclude(pk=transaction.pk)
        .with_happened_at()
        .filter(happened_at__lt=happened)
        .order_by("-happened_at")
        .first()
    )
    if not previous:
        return False, {}
    days_inactive = (happened - previous.happened_at).days
    if days_inactive < dormant_days:
        return False, {}
    return True, {
        "days_inactive": days_inactive,
        "dormant_threshold": dormant_days,
        "transaction_amount": float(amount),
        "min_amount": float(min_amount),
        "last_activity": previous.happened_at.isoformat(),
        "reason": f"Dormant account reactivation after {days_inactive} days with ${float(amount):,.2f} transaction",
    }


def _check_pattern_deviation(rule, transaction, user_account) -> RuleResult:
    if transaction is None:
        return False, {}
    multiplier = rule.parameters.get("multiplier", PATTERN_DEVIATION_MULTIPLIER)
    min_history = rule.parameters.get("min_history", PATTERN_DEVIATION_MIN_HISTORY)
    baseline_days = rule.parameters.get("baseline_days", PATTERN_DEVIATION_BASELINE_DAYS)
    amount = _aud_value(transaction)
    if amount <= 0:
        return False, {}
    history = (
        Transaction.objects.filter(
            wallet__user_account=user_account, market_value_aud__isnull=False, market_value_aud__gt=0
        )
        .exclude(uuid=transaction.uuid)
        .happened_since(timezone.now() - timedelta(days=baseline_days))
    )
    history_count = history.count()
    if history_count < min_history:
        return False, {}
    average = history.aggregate(avg=Avg("market_value_aud"))["avg"] or Decimal("0")
    if average <= 0 or amount < average * multiplier:
        return False, {}
    return True, {
        "transaction_amount": float(amount),
        "average_amount": float(average),
        "deviation_multiplier": multiplier,
        "deviation_threshold": float(average * multiplier),
        "historical_count": history_count,
        "baseline_days": baseline_days,
        "reason": (
            f"Transaction ${float(amount):,.2f} is {float(amount / average):.1f}x the customer average "
            f"of ${float(average):,.2f}"
        ),
    }


def _check_round_amounts(rule, transaction, user_account) -> RuleResult:
    count_threshold = rule.parameters.get("count", ROUND_AMOUNT_COUNT_THRESHOLD)
    period_days = rule.parameters.get("period_days", ROUND_AMOUNT_PERIOD_DAYS)
    divisor = Decimal(str(rule.parameters.get("divisor", ROUND_AMOUNT_DIVISOR)))
    min_amount = Decimal(str(rule.parameters.get("min_amount", 1000)))
    recent = Transaction.objects.filter(
        wallet__user_account=user_account, market_value_aud__isnull=False, market_value_aud__gte=min_amount
    ).happened_since(timezone.now() - timedelta(days=period_days))
    round_amounts = [float(tx.market_value_aud) for tx in recent if tx.market_value_aud % divisor == 0]
    if len(round_amounts) < count_threshold:
        return False, {}
    return True, {
        "round_amount_count": len(round_amounts),
        "count_threshold": count_threshold,
        "divisor": float(divisor),
        "period_days": period_days,
        "round_amounts": round_amounts[:10],
        "reason": (
            f"Found {len(round_amounts)} transactions with round amounts "
            f"(divisible by ${float(divisor):,.0f}) in {period_days} days"
        ),
    }


RULE_CHECKS = {
    RULE_TYPE_THRESHOLD: _check_threshold,
    RULE_TYPE_RAPID_TRANSACTIONS: _check_rapid_transactions,
    RULE_TYPE_PATTERN: _check_structuring_pattern,
    RULE_TYPE_SOF_REQUIRED: _check_sof_required,
    RULE_TYPE_AGGREGATE_VOLUME: _check_aggregate_volume,
    RULE_TYPE_DORMANT_REACTIVATION: _check_dormant_reactivation,
    RULE_TYPE_PATTERN_DEVIATION: _check_pattern_deviation,
    RULE_TYPE_ROUND_AMOUNTS: _check_round_amounts,
}


def check_rule(rule: MonitoringRule, transaction, user_account) -> RuleResult:
    checker = RULE_CHECKS.get(rule.rule_type)
    return checker(rule, transaction, user_account) if checker else (False, {})


class TransactionMonitoringService:
    @classmethod
    def queue_new_transaction(cls, tx) -> None:
        cutoff = timezone.now() - timedelta(hours=TRANSACTION_MONITORING_WINDOW_HOURS)
        if tx.block_timestamp and tx.block_timestamp < cutoff:
            return
        from compliance.tasks import screen_transaction

        defer(screen_transaction, transaction_uuid=str(tx.pk))

    @classmethod
    def check_recorded_transaction(cls, transaction_uuid):
        with atomic():
            tx = Transaction.objects.filter(pk=transaction_uuid).first()
            if tx is None:
                return {"status": "not_found"}
            if lock_active_profile(tx.wallet.user_account.user_profile) is None:
                return {"status": "closed_account"}
            tx = Transaction.objects.select_for_update().get(pk=transaction_uuid)
            if tx.monitoring_completed_at is not None:
                return {"status": "already_completed"}
            alerts = cls.check_transaction(transaction=tx, user_account=tx.wallet.user_account)
            tx.monitoring_completed_at = timezone.now()
            tx.save(update_fields=["monitoring_completed_at"])
        return {"status": "completed", "alerts": len(alerts)}

    @classmethod
    def check_transaction(cls, transaction, user_account) -> List[ComplianceAlert]:
        alerts = []
        for rule in MonitoringRule.objects.active():
            triggered, details = check_rule(rule, transaction, user_account)
            if triggered:
                alert = cls._create_alert(rule, user_account, transaction, details)
                if alert is not None:
                    alerts.append(alert)
                logger.info(
                    f"Rule {rule.rule_code} triggered for "
                    f"user_account {user_account.uuid}, transaction {transaction.uuid}"
                )
        return alerts

    @classmethod
    def check_batch_patterns(cls, user_account) -> List[ComplianceAlert]:
        alerts = []
        for rule in MonitoringRule.objects.active().pattern_rules():
            triggered, details = check_rule(rule, None, user_account)
            already_open = ComplianceAlert.objects.filter(
                user_account=user_account,
                monitoring_rule=rule,
                status__in=[ALERT_STATUS_NEW, ALERT_STATUS_REVIEWING],
            ).exists()
            if triggered and not already_open:
                alert = cls._create_alert(rule, user_account, None, details)
                if alert is not None:
                    alerts.append(alert)
                logger.info(f"Batch rule {rule.rule_code} triggered for user_account {user_account.uuid}")
        return alerts

    @staticmethod
    @atomic()
    def _create_alert(rule: MonitoringRule, user_account, transaction, details: Dict) -> ComplianceAlert:
        if lock_active_profile(user_account.user_profile) is None:
            return None
        return ComplianceAlert.objects.create(
            user_account=user_account,
            transaction=transaction,
            monitoring_rule=rule,
            alert_type=RULE_CODE_TO_ALERT_TYPE.get(rule.rule_code, rule.rule_code.lower().replace("-", "_")),
            severity=rule.alert_severity,
            triggered_rule=rule.rule_code,
            description=f"{rule.name}: {rule.description}",
            alert_data=details,
            status=ALERT_STATUS_NEW,
        )
