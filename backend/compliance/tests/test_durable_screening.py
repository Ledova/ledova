import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import MagicMock, patch

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone

from compliance.constants import (
    RULE_TYPE_THRESHOLD,
    TRANSACTION_MONITORING_WINDOW_HOURS,
)
from compliance.models import ComplianceAlert, MonitoringRule
from compliance.services.transaction_monitoring import TransactionMonitoringService
from compliance.tasks import screen_transaction
from ledova_backend.procrastinate_app import app
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import an_account
from wallets.models import Transaction, Wallet
from wallets.services.sync import sync_wallet


class ScopedDurableScreeningTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.account = an_account("durable-screening")
            self.user = self.account.user_profile.user
            self.wallet = Wallet.objects.create(
                user_account=self.account, chain="ethereum", address="0x" + "c" * 40, verification_status="VERIFIED"
            )
            self.rule = MonitoringRule.objects.create(
                rule_code="MON-001", name="Synthetic threshold", rule_type=RULE_TYPE_THRESHOLD, parameters={"amount": 0}
            )
        self.initial_jobs = set(self.jobs())
        self.addCleanup(self.remove_jobs)
        client = MagicMock()
        client.get_transaction_history.return_value = [
            {
                "tx_hash": "0x" + "1" * 64,
                "from_address": "0x" + "d" * 40,
                "to_address": self.wallet.address,
                "amount": "1.5",
                "block_timestamp": timezone.now(),
            }
        ]
        rpc = patch("wallets.services.sync.get_blockchain_client", return_value=client)
        self.addCleanup(rpc.stop)
        rpc.start()

    def jobs(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute(
                "SELECT id, args, status, attempts FROM procrastinate_jobs WHERE task_name = %s",
                [screen_transaction.name],
            )
            return {
                row[0]: (row[1] if isinstance(row[1], dict) else json.loads(row[1]), row[2], row[3])
                for row in cursor.fetchall()
            }

    def remove_jobs(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            for job_id in set(self.jobs()) - self.initial_jobs:
                cursor.execute("DELETE FROM procrastinate_jobs WHERE id = %s", [job_id])

    def enqueue(self):
        with acting_for(self.user.pk):
            self.assertEqual(sync_wallet(self.wallet)["status"], "success")
        jobs = {key: value for key, value in self.jobs().items() if key not in self.initial_jobs}
        self.assertEqual(len(jobs), 1)
        return next(iter(jobs.items()))

    def recorded(self):
        with use_operator():
            return Transaction.objects.get(wallet=self.wallet)

    def alerts(self):
        with use_operator():
            return list(ComplianceAlert.objects.filter(user_account=self.account))

    def test_scoped_import_commits_its_job_without_touching_operator_alerts(self):
        observed = []

        def record(execute, sql, params, many, context):
            observed.append((context["connection"].alias, sql))
            return execute(sql, params, many, context)

        with acting_for(self.user.pk):
            with connections[APP_ALIAS].execute_wrapper(record), connections[OPERATOR_ALIAS].execute_wrapper(record):
                self.assertEqual(sync_wallet(self.wallet)["status"], "success")
        self.assertEqual({alias for alias, _ in observed}, {APP_ALIAS})
        self.assertTrue(any("procrastinate_defer" in sql for _, sql in observed))
        tx = self.recorded()
        jobs = {key: value for key, value in self.jobs().items() if key not in self.initial_jobs}
        self.assertEqual(len(jobs), 1)
        payload, status, attempts = next(iter(jobs.values()))
        self.assertEqual((payload, status, attempts), ({"transaction_uuid": str(tx.pk)}, "todo", 0))
        self.assertEqual(self.alerts(), [])
        self.assertIsNone(tx.monitoring_completed_at)
        self.assertEqual(screen_transaction.func(**payload), {"status": "completed", "alerts": 1})
        self.assertEqual(len(self.alerts()), 1)
        self.assertIsNotNone(self.recorded().monitoring_completed_at)

    def test_an_outer_rollback_removes_the_transaction_and_its_uncommitted_job(self):
        with self.assertRaisesRegex(RuntimeError, "rollback"):
            with acting_for(self.user.pk), atomic():
                self.assertEqual(sync_wallet(self.wallet)["status"], "success")
                self.assertTrue(Transaction.objects.filter(wallet=self.wallet).exists())
                with connections[APP_ALIAS].cursor() as cursor:
                    cursor.execute(
                        "SELECT count(*) FROM procrastinate_jobs WHERE task_name = %s", [screen_transaction.name]
                    )
                    self.assertEqual(cursor.fetchone()[0], len(self.initial_jobs) + 1)
                self.assertEqual(set(self.jobs()), self.initial_jobs)
                raise RuntimeError("rollback")
        with use_operator():
            self.assertFalse(Transaction.objects.filter(wallet=self.wallet).exists())
        self.assertEqual(set(self.jobs()), self.initial_jobs)
        self.enqueue()

    def run_worker(self, job_id, check):
        queue = f"screening-{self.wallet.pk}"
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute("UPDATE procrastinate_jobs SET queue_name = %s WHERE id = %s", [queue, job_id])
        app.perform_import_paths()
        with (
            patch.object(TransactionMonitoringService, "check_transaction", side_effect=check),
            patch.object(screen_transaction.retry_strategy, "wait", 0),
            patch.dict(connections[OPERATOR_ALIAS].settings_dict, {"CONN_MAX_AGE": 0}),
            patch.dict(app.periodic_registry.periodic_tasks, {}, clear=True),
            app.replace_connector(app.connector.get_worker_connector()),
        ):
            app.run_worker(
                queues=[queue], wait=False, listen_notify=False, install_signal_handlers=False, delete_jobs="never"
            )
        return self.jobs()[job_id]

    def test_a_real_worker_retries_a_failed_alert_write_and_commits_one_result(self):
        job_id, _ = self.enqueue()
        original = TransactionMonitoringService.check_transaction
        observed = []

        def check(**kwargs):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                observed.append((current_alias(), cursor.fetchone()[0]))
            alerts = original(**kwargs)
            if len(observed) == 1:
                raise RuntimeError("after alert insert")
            return alerts

        _, status, attempts = self.run_worker(job_id, check)
        self.assertEqual((status, attempts), ("succeeded", 2))
        self.assertEqual(observed, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS])] * 2)
        self.assertEqual(len(self.alerts()), 1)
        self.assertIsNotNone(self.recorded().monitoring_completed_at)
        self.assertEqual(screen_transaction.func(str(self.recorded().pk)), {"status": "already_completed"})
        self.assertEqual(len(self.alerts()), 1)

    def test_exhausted_worker_attempts_keep_a_failed_job_and_no_partial_alerts(self):
        job_id, _ = self.enqueue()
        original = TransactionMonitoringService.check_transaction

        def check(**kwargs):
            original(**kwargs)
            raise RuntimeError("after alert insert")

        _, status, attempts = self.run_worker(job_id, check)
        self.assertEqual((status, attempts), ("failed", 5))
        self.assertEqual(self.alerts(), [])
        self.assertIsNone(self.recorded().monitoring_completed_at)
        self.assertEqual(screen_transaction.func(str(self.recorded().pk))["status"], "completed")
        self.assertEqual(len(self.alerts()), 1)

    def test_concurrent_deliveries_screen_one_transaction_once(self):
        self.enqueue()
        tx_id = str(self.recorded().pk)
        start = Barrier(2)

        def deliver():
            try:
                start.wait(timeout=10)
                return screen_transaction.func(tx_id)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: deliver(), range(2)))
        self.assertCountEqual(results, [{"status": "completed", "alerts": 1}, {"status": "already_completed"}])
        self.assertEqual(len(self.alerts()), 1)

    def test_a_delayed_worker_retains_the_screening_decision_made_at_enqueue(self):
        _, (payload, _, _) = self.enqueue()
        later = timezone.now() + timedelta(hours=TRANSACTION_MONITORING_WINDOW_HOURS + 1)
        with patch("compliance.services.transaction_monitoring.timezone.now", return_value=later):
            self.assertEqual(screen_transaction.func(**payload), {"status": "completed", "alerts": 1})
        self.assertEqual(len(self.alerts()), 1)
