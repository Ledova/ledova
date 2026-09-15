from unittest.mock import patch

from django.contrib.admin.models import LogEntry
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.contrib.messages import get_messages
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse

from shared.db import atomic, current_alias
from tokens.models import TokenDeployment
from tokens.services import swap_approval
from tokens.tests.deployment_fixtures import CHAIN_ID, FACTORY, KEY
from tokens.tests.swap_approval_fixtures import SWAP, install_approval
from tokens.tests.test_share_token_admin import TEST_STORAGES


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    ATOMIC_SWAP_ADDRESS=SWAP,
    STORAGES=TEST_STORAGES,
)
class SwapApprovalBoundaryTest(TransactionTestCase):
    def setUp(self):
        install_approval(self)

    def queued(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT id FROM procrastinate_jobs WHERE task_name=%s AND args->>'deployment_id'=%s ORDER BY id",
                ["tokens.tasks.deployment.recover_swap_approval", str(self.command.pk)],
            )
            return [row[0] for row in cursor.fetchall()]

    def failed(self):
        self.approval_node.receipt_status = 0
        self.assertEqual(swap_approval.recover(self.command.pk), "failed")
        return get_user_model().objects.create_superuser(email="approval-admin@example.test", password="test")

    def test_retry_commit_acknowledgement_loss_replays_the_admitted_job(self):
        actor = self.failed()
        confirmation = swap_approval.retry_confirmation(self.token, actor)
        connection = connections[current_alias()]
        commit = connection.commit

        def committed_then_disconnected():
            commit()
            raise ConnectionError("Synthetic retry acknowledgement loss")

        with patch.object(connection, "commit", side_effect=committed_then_disconnected):
            with self.assertRaises(ConnectionError):
                swap_approval.retry(self.token, actor, confirmation)
        before = self.queued()
        self.assertEqual(len(before), 2)
        self.assertEqual(swap_approval.retry(self.token, actor, confirmation), "executing")
        self.assertEqual(self.queued(), before)
        self.approval_node.receipt_status = 1
        self.assertEqual(swap_approval.recover(self.command.pk), "confirmed")

    def assert_locks_available(self):
        observer = connections[current_alias()].copy(alias="approval-lock-observer")
        try:
            with observer.cursor() as cursor:
                for table in ("tokens_tokendeployment", "blockchain_outgoingoperation", "blockchain_signingaccount"):
                    cursor.execute(f"SELECT uuid FROM {table} FOR UPDATE NOWAIT")
                    cursor.fetchall()
        finally:
            observer.close()

    def test_separate_connection_probe_refuses_a_deliberately_held_deployment_lock(self):
        with atomic():
            TokenDeployment.objects.select_for_update().get(pk=self.command.pk)
            with self.assertRaises(DatabaseError):
                self.assert_locks_available()
        self.assert_locks_available()

    def test_chain_observation_preparation_receipt_and_broadcast_release_locks(self):
        calls = []

        def probe(label):
            connection = connections[current_alias()]
            self.assertTrue(connection.get_autocommit())
            self.assert_locks_available()
            calls.append(label)

        def get_block(*args):
            probe("block")
            return self.approval_node.client.get_block.return_value

        def estimate(*args):
            probe("estimate")
            return 60000

        def send(raw):
            probe("send")
            observer = connections[current_alias()].copy(alias="approval-signed-observer")
            try:
                with observer.cursor() as cursor:
                    cursor.execute(
                        "SELECT b.tx_hash, a.tx_hash, a.raw_transaction FROM tokens_tokendeployment d "
                        "JOIN blockchain_outgoingoperation o ON d.approval_operation_id=o.uuid "
                        "JOIN blockchain_signedattempt a ON o.current_attempt_id=a.uuid "
                        "JOIN blockchain_blockchaintransaction b ON d.approval_transaction_id=b.uuid WHERE d.uuid=%s",
                        [self.command.pk],
                    )
                    associated, signed, stored = cursor.fetchone()
                    self.assertEqual(associated, signed)
                    self.assertEqual(bytes(stored), raw)
            finally:
                observer.close()
            return self.approval_node.send(raw)

        def receipt(tx_hash):
            probe("receipt")
            return self.approval_node.receipts.get(tx_hash)

        self.approval_node.client.get_block.side_effect = get_block
        self.approval_node.client.estimate_gas.side_effect = estimate
        self.approval_node.client.send_raw_transaction.side_effect = send
        self.approval_node.client.get_transaction_receipt.side_effect = receipt
        self.assertEqual(swap_approval.recover(self.command.pk), "confirmed")
        self.assertEqual(set(calls), {"block", "estimate", "send", "receipt"})

    def test_admin_confirmation_requires_current_change_permission_and_replays_once(self):
        self.failed()
        actor = get_user_model().objects.create_user(
            email="approval-staff@example.test", password="test", is_staff=True, is_active=True, is_email_verified=True
        )
        url = reverse("admin:tokens_sharetoken_retry_swap_approval", args=[self.token.pk])
        self.client.force_login(actor)
        self.assertEqual(self.client.get(url).status_code, 403)
        actor.user_permissions.add(Permission.objects.get(codename="change_sharetoken"))
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "original swap contract")
        confirmation = response.context["confirmation"]
        self.assertEqual(len(self.queued()), 1)
        response = self.client.post(url, {"confirmation": confirmation})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(self.queued()), 2)
        self.assertEqual(self.client.post(url, {"confirmation": confirmation}).status_code, 302)
        self.assertEqual(len(self.queued()), 2)
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_outcome, "executing")
        actor.user_permissions.clear()
        self.assertEqual(self.client.post(url, {"confirmation": confirmation}).status_code, 403)

    def test_task_sweep_recovers_only_aged_active_approvals(self):
        from datetime import timedelta

        from django.utils import timezone

        from tokens.tasks.deployment import check_pending_swap_approvals

        self.assertEqual(check_pending_swap_approvals.func(), {"checked": 0, "resolved": 0})
        TokenDeployment.objects.filter(pk=self.command.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(check_pending_swap_approvals.func(), {"checked": 1, "resolved": 1})
        self.assertEqual(check_pending_swap_approvals.func(), {"checked": 0, "resolved": 0})

    def test_admin_terminal_replay_reports_the_retained_outcome_without_queuing(self):
        actor = self.failed()
        confirmation = swap_approval.retry_confirmation(self.token, actor)
        swap_approval.retry(self.token, actor, confirmation)
        self.approval_node.receipt_status = 1
        self.assertEqual(swap_approval.recover(self.command.pk), "confirmed")
        before = self.queued()
        self.client.force_login(actor)
        response = self.client.post(
            reverse("admin:tokens_sharetoken_retry_swap_approval", args=[self.token.pk]),
            {"confirmation": confirmation},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.queued(), before)
        notices = [str(message) for message in get_messages(response.wsgi_request)]
        self.assertEqual(notices, ["Existing swap approval retry: Approval confirmed."])
        self.assertEqual(LogEntry.objects.get(object_id=str(self.token.pk)).change_message, notices[0])
