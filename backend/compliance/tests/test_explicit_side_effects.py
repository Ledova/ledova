from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from compliance.constants import (
    ASSESSMENT_STATUS_PENDING,
    RULE_TYPE_RAPID_TRANSACTIONS,
    TRANSACTION_MONITORING_WINDOW_HOURS,
)
from compliance.models import ComplianceAlert, CustomerRiskAssessment, MonitoringRule
from compliance.tasks import screen_transaction
from shared.db import current_alias
from shared.tests.tenants import an_account
from users.models import UserProfile
from users.services.setup import ensure_defaults
from wallets.models import Transaction, Wallet
from wallets.services import transaction_confirmation
from wallets.services.sync import sync_wallet

User = get_user_model()

CHECK = "compliance.services.transaction_monitoring.TransactionMonitoringService.check_transaction"


def tx_payload(tx_hash, block_timestamp):
    return {
        "tx_hash": tx_hash,
        "from_address": "0x" + "d" * 40,
        "to_address": "0x" + "c" * 40,
        "amount": "1.5",
        "asset_symbol": "ETH",
        "block_timestamp": block_timestamp,
    }


class TransactionMonitoringOnCreateTest(TestCase):
    def setUp(self):
        self.account = an_account("explicit-side-effects", account_number="MON-ACC")
        self.wallet = Wallet.objects.create(
            user_account=self.account,
            address="0x" + "c" * 40,
            chain="ethereum",
            verification_status="VERIFIED",
        )

    def sync(self, *payloads):
        client = MagicMock()
        client.get_transaction_history.return_value = list(payloads)
        with patch("wallets.services.sync.get_blockchain_client", return_value=client):
            return sync_wallet(self.wallet)

    def jobs_for(self, tx_hash):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT id FROM procrastinate_jobs WHERE task_name = %s "
                "AND args->>'transaction_uuid' IN (SELECT uuid::text FROM transactions WHERE tx_hash = %s)",
                [screen_transaction.name, tx_hash],
            )
            return [row[0] for row in cursor.fetchall()]

    def test_sync_queues_each_newly_created_transaction_once_without_inline_screening(self):
        with patch(CHECK) as check:
            self.assertEqual(self.sync(tx_payload("0xnew", timezone.now()))["transactions"], 1)
            self.assertEqual(self.sync(tx_payload("0xnew", timezone.now()))["transactions"], 0)
        check.assert_not_called()
        self.assertEqual(len(self.jobs_for("0xnew")), 1)

    def test_sync_skips_screening_for_transactions_older_than_the_window(self):
        old = timezone.now() - timedelta(hours=TRANSACTION_MONITORING_WINDOW_HOURS, minutes=1)
        self.assertEqual(self.sync(tx_payload("0xold", old))["transactions"], 1)
        self.assertEqual(self.jobs_for("0xold"), [])
        self.assertEqual(self.sync(tx_payload("0xcurrent", timezone.now()))["transactions"], 1)
        self.assertEqual(len(self.jobs_for("0xcurrent")), 1)

    def test_enqueue_failure_rolls_back_the_sync_transaction(self):
        with patch("compliance.services.transaction_monitoring.App.configure_task", side_effect=RuntimeError("down")):
            result = self.sync(tx_payload("0xboom", timezone.now()))
        self.assertEqual(result["status"], "error")
        self.assertFalse(Transaction.objects.filter(tx_hash="0xboom", wallet=self.wallet).exists())
        self.assertEqual(self.sync(tx_payload("0xboom", timezone.now()))["transactions"], 1)
        self.assertEqual(len(self.jobs_for("0xboom")), 1)

    def test_a_pending_transfer_commits_a_screening_job(self):
        with patch(CHECK) as check:
            result = transaction_confirmation.create_pending_transaction(
                wallet=self.wallet, tx_hash="0xpending", to_address="0x" + "e" * 40, amount=Decimal("0.5")
            )
        self.assertEqual(result["status"], "pending")
        check.assert_not_called()
        self.assertEqual(len(self.jobs_for("0xpending")), 1)

    def test_enqueue_failure_rolls_back_a_pending_transfer(self):
        with patch("compliance.services.transaction_monitoring.App.configure_task", side_effect=RuntimeError("down")):
            with self.assertRaisesRegex(RuntimeError, "down"):
                transaction_confirmation.create_pending_transaction(
                    wallet=self.wallet, tx_hash="0xpending", to_address="0x" + "e" * 40, amount=Decimal("0.5")
                )
        self.assertFalse(Transaction.objects.filter(tx_hash="0xpending", wallet=self.wallet).exists())
        self.assertEqual(self.jobs_for("0xpending"), [])

    def test_the_worker_creates_an_alert_once_for_the_recorded_transaction(self):
        rule = MonitoringRule.objects.create(
            rule_code="MON-002",
            name="Rapid",
            description="More than one transaction per hour",
            rule_type=RULE_TYPE_RAPID_TRANSACTIONS,
            parameters={"max_transactions": 1, "period_minutes": 60},
        )
        self.assertEqual(self.sync(tx_payload("0xrapid", timezone.now()))["transactions"], 1)
        self.assertFalse(ComplianceAlert.objects.filter(monitoring_rule=rule).exists())
        tx = Transaction.objects.get(tx_hash="0xrapid")
        self.assertEqual(screen_transaction.func(str(tx.pk)), {"status": "completed", "alerts": 1})
        self.assertEqual(screen_transaction.func(str(tx.pk)), {"status": "already_completed"})
        alert = ComplianceAlert.objects.get(monitoring_rule=rule)
        self.assertEqual((alert.transaction, alert.user_account), (tx, self.account))
        tx.refresh_from_db()
        self.assertIsNotNone(tx.monitoring_completed_at)


class PendingRiskAssessmentOnAccountCreateTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="assess@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=self.user)

    def pending_for(self, account):
        return CustomerRiskAssessment.objects.filter(user_account=account, assessment_status=ASSESSMENT_STATUS_PENDING)

    def test_ensure_defaults_creates_one_pending_assessment_for_a_new_account(self):
        _, account, _, _ = ensure_defaults(self.user)
        ensure_defaults(self.user)

        self.assertEqual(self.pending_for(account).count(), 1)
