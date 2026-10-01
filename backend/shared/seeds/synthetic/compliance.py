from datetime import timedelta

from compliance.models import ComplianceAlert, MonitoringRule, TransactionScreening
from shared.db import atomic
from shared.seeds.synthetic.alerts import SCREENING_FAILURE
from shared.seeds.synthetic.clock import frozen

SCREENING_PROVIDER = "kycaid"


def apply_alerts(plan, seeded):
    rules = {rule.rule_code: rule for rule in MonitoringRule.objects.all()}
    for alert in plan.alerts:
        with atomic():
            transaction = seeded.transactions.get(alert.transfer)
            if alert.screened and alert.transfer not in seeded.screenings:
                seeded.screenings[alert.transfer] = _screening(transaction, seeded.accounts[alert.person])
            with frozen(alert.created_at):
                record = ComplianceAlert.objects.create(
                    user_account=seeded.accounts[alert.person],
                    transaction=transaction,
                    monitoring_rule=rules.get(alert.rule),
                    alert_type=alert.alert_type,
                    severity=alert.severity,
                    triggered_rule=alert.rule,
                    description=alert.description,
                    alert_data=seeded.resolve(alert.data),
                )
            ComplianceAlert.objects.filter(pk=record.pk).update(**_outcome(alert, seeded))


def _screening(transaction, account):
    with frozen(transaction.created_at + timedelta(seconds=4)):
        return TransactionScreening.objects.create(
            transaction=transaction,
            user_account=account,
            provider=SCREENING_PROVIDER,
            provider_transaction_id=str(transaction.pk),
            to_address=transaction.to_address or "",
            from_address=transaction.from_address,
            status="failed",
            error_message=SCREENING_FAILURE,
        )


def _outcome(alert, seeded):
    moments = [
        moment
        for moment in (alert.assigned_at, alert.account_action_at, alert.smr_filed_at, alert.resolved_at)
        if moment
    ]
    return {
        "status": alert.status,
        "assigned_to": seeded.users.get(alert.assignee),
        "assigned_at": alert.assigned_at,
        "resolution_notes": alert.notes,
        "resolved_at": alert.resolved_at,
        "resolved_by": seeded.users.get(alert.resolver),
        "investigation_outcome": alert.outcome,
        "smr_required": alert.smr_type is not None,
        "smr_type": alert.smr_type,
        "smr_reference": alert.smr_reference,
        "smr_filed_at": alert.smr_filed_at,
        "account_action": alert.account_action,
        "account_action_at": alert.account_action_at,
        "updated_at": max(moments, default=alert.created_at),
    }
