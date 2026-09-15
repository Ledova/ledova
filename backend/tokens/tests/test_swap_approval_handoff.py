import json
import os
import signal
import subprocess
import sys
import tempfile
from unittest.mock import patch

from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings

from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from tokens.exceptions import TokenDeploymentFailedException
from tokens.models import TokenDeployment
from tokens.services import deployment, deployment_journal
from tokens.tests.deployment_fixtures import CHAIN_ID, FACTORY, KEY, install_deployment

SWAP = "0x" + "d" * 40


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    ATOMIC_SWAP_ADDRESS=SWAP,
)
class SwapApprovalHandoffTest(TransactionTestCase):
    def setUp(self):
        install_deployment(self)

    def approval_jobs(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT args FROM procrastinate_jobs WHERE task_name=%s ORDER BY id",
                ["tokens.tasks.deployment.recover_swap_approval"],
            )
            return [row[0] if isinstance(row[0], dict) else json.loads(row[0]) for row in cursor.fetchall()]

    def test_stop_after_deployment_projection_retains_one_approval_job(self):
        original = deployment_journal.mark_projected

        def commit_then_stop(deployment_id):
            original(deployment_id)
            raise SystemExit

        with patch.object(deployment_journal, "mark_projected", side_effect=commit_then_stop):
            with self.assertRaises(SystemExit):
                deployment.deploy_token(self.token)
        record = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertIsNotNone(record.projected_at)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")
        self.assertEqual(self.approval_jobs(), [{"deployment_id": str(record.pk)}])
        deployment.recover(record.pk)
        self.assertEqual(self.approval_jobs(), [{"deployment_id": str(record.pk)}])

    def test_queue_failure_keeps_projection_recoverable(self):
        with patch(
            "tokens.tasks.deployment.recover_swap_approval.defer", side_effect=DatabaseError("Synthetic queue failure")
        ):
            with self.assertRaises(TokenDeploymentFailedException):
                deployment.deploy_token(self.token)
        record = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertIsNone(record.projected_at)
        self.assertEqual(record.approval_outcome, "")
        self.assertEqual(self.approval_jobs(), [])
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")
        deployment.recover(record.pk)
        record.refresh_from_db()
        self.assertIsNotNone(record.projected_at)
        self.assertEqual(record.approval_outcome, "pending")
        self.assertEqual(self.approval_jobs(), [{"deployment_id": str(record.pk)}])

    def test_killed_worker_leaves_committed_approval_job_after_projection(self):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["DEPLOYMENT_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        with tempfile.TemporaryDirectory(prefix="approval-handoff-") as directory:
            process = subprocess.Popen(
                [sys.executable, "-m", "tokens.tests.deployment_worker", directory, "handoff", str(self.token.pk)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        self.token.refresh_from_db()
        record = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertEqual(self.token.status, "deployed")
        self.assertIsNotNone(record.projected_at)
        self.assertEqual(record.approval_outcome, "pending")
        self.assertIsNone(record.approval_operation_id)
        self.assertEqual(self.approval_jobs(), [{"deployment_id": str(record.pk)}])

    def test_missing_swap_configuration_is_a_terminal_disposition(self):
        with override_settings(ATOMIC_SWAP_ADDRESS=""):
            deployment.deploy_token(self.token)
        record = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertEqual(record.approval_outcome, "not_configured")
        self.assertIsNone(record.approval_intent)
        self.assertEqual(self.approval_jobs(), [])

    def test_invalid_swap_configuration_does_not_strand_deployment_completion(self):
        with override_settings(ATOMIC_SWAP_ADDRESS="0x-invalid"):
            deployment.deploy_token(self.token)
        record = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertIsNotNone(record.projected_at)
        self.assertEqual(record.approval_outcome, "not_configured")
        self.assertIsNone(record.approval_intent)
        self.assertEqual(self.approval_jobs(), [])
        deployment.recover(record.pk)
        record.refresh_from_db()
        self.assertEqual(record.approval_outcome, "not_configured")
        self.assertEqual(self.approval_jobs(), [])
