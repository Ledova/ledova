import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from decimal import Decimal
from pathlib import Path

from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.tests.outgoing_fixtures import admitted_signer
from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from tokens.models import ShareIssuanceExecution
from tokens.services import issuance_execution
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY, admit, issuance_request


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class IssuanceExecutionProcessTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.actor = issuance_request("issuance-process")
        self.request = self.tenant.issuance_request
        self.form = issuance_execution.confirmation(self.request, self.actor)
        admitted_signer()

    def worker(self, directory, phase, form=None):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["ISSUANCE_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        args = [
            sys.executable,
            "-m",
            "tokens.tests.issuance_worker",
            str(directory),
            phase,
            str(self.request.pk),
            str(self.actor.pk),
            form or self.form,
        ]
        process = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.stop, process)
        return process

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)

    def await_file(self, path):
        until = time.monotonic() + 20
        while not path.exists() and time.monotonic() < until:
            time.sleep(0.01)
        self.assertTrue(path.exists(), str(path))

    def successful(self, process):
        code, out, err = finish(process)
        self.assertEqual(code, 0, out + err)
        return json.loads(out)

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="issuance-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "approved" if phase == "admitted" else "executing")
            self.assertEqual(ShareIssuanceExecution.objects.count(), 1)
            self.assertEqual(SignedAttempt.objects.count(), int(signed))
            if phase == "opened":
                self.assertIsNone(ShareIssuanceExecution.objects.get().operation_id)
                self.assertEqual(OutgoingOperation.objects.get().status, "preparing")
            original = SignedAttempt.objects.values("tx_hash", "raw_transaction", "nonce").first()
            if not signed:
                self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "executed")
            attempt = SignedAttempt.objects.get()
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original["tx_hash"], bytes(original["raw_transaction"]), original["nonce"]),
                )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 8)
            self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")

    def test_kill_after_admission_preserves_request_and_recovers(self):
        self.recover_killed("admitted", False)

    def test_kill_after_public_claim_before_operation_opening_recovers(self):
        self.recover_killed("claimed", False)

    def test_kill_after_opening_before_binding_recovers_the_same_operation(self):
        self.recover_killed("opened", False)
        self.assertEqual(OutgoingOperation.objects.count(), 1)

    def test_kill_before_signed_commit_rolls_back_nonce_and_recovers(self):
        self.recover_killed("before_commit", False)

    def test_kill_after_signed_commit_recovers_original_bytes(self):
        self.recover_killed("signed", True)

    def test_kill_after_provider_acceptance_reads_original_receipt(self):
        self.recover_killed("accepted", True)

    def test_independent_workers_share_one_signed_attempt_and_nonce(self):
        with tempfile.TemporaryDirectory(prefix="issuance-race-") as temporary:
            directory = Path(temporary)
            processes = [self.worker(directory, "race") for _ in range(2)]
            for process in processes:
                self.await_file(directory / f"ready-{process.pid}")
            (directory / "go").touch()
            for process in processes:
                self.assertIn(self.successful(process)["status"], ("executing", "executed"))
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_kill_before_revert_projection_retains_receipt_and_needs_new_retry_confirmation(self):
        with tempfile.TemporaryDirectory(prefix="issuance-revert-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "before_revert_projection"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            previous = BlockchainTransaction.objects.get()
            self.assertEqual(previous.status, "reverted")
            self.assertEqual(ShareIssuanceExecution.objects.get().status, "executing")
            claim = OutgoingOperation.objects.get().claim_id
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "failed")
            previous.refresh_from_db()
            self.assertEqual(previous.status, "reverted")
            self.assertEqual(self.successful(self.worker(directory, "execute"))["status"], "failed")
            retry = issuance_execution.confirmation(self.request, self.actor)
            self.assertEqual(self.successful(self.worker(directory, "execute", retry))["status"], "executed")
            self.assertNotEqual(OutgoingOperation.objects.get().claim_id, claim)
            self.assertEqual(SignedAttempt.objects.count(), 2)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
            previous.refresh_from_db()
            self.assertEqual(previous.status, "reverted")

    def reverted(self, directory):
        code, out, err = finish(self.worker(directory, "before_revert_projection"))
        self.assertEqual(code, -signal.SIGKILL, out + err)
        self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "failed")
        return OutgoingOperation.objects.get().claim_id, issuance_execution.confirmation(self.request, self.actor)

    def test_kill_after_explicit_retry_admission_recovers_the_authorized_claim(self):
        with tempfile.TemporaryDirectory(prefix="issuance-admitted-retry-") as temporary:
            directory = Path(temporary)
            previous_claim, retry = self.reverted(directory)
            code, out, err = finish(self.worker(directory, "admitted", retry))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            command = ShareIssuanceExecution.objects.get()
            self.assertEqual(command.retry_of, previous_claim)
            self.assertEqual(command.status, "queued")
            self.assertEqual(command.operation.claim_id, previous_claim)
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "approved")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "executed")
            self.assertNotEqual(OutgoingOperation.objects.get().claim_id, previous_claim)
            self.assertEqual(SignedAttempt.objects.count(), 2)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
            self.assertEqual(BlockchainTransaction.objects.filter(status="reverted").count(), 1)

    def test_independent_explicit_retry_workers_share_one_new_claim_and_nonce(self):
        with tempfile.TemporaryDirectory(prefix="issuance-retry-race-") as temporary:
            directory = Path(temporary)
            previous_claim, retry = self.reverted(directory)
            processes = [self.worker(directory, "race", retry) for _ in range(2)]
            for process in processes:
                self.await_file(directory / f"ready-{process.pid}")
            (directory / "go").touch()
            for process in processes:
                self.assertIn(self.successful(process)["status"], ("executing", "executed"))
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "executed")
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(len(ledger["hashes"]), 2)
            self.assertEqual(len(set(ledger["broadcasts"])), 2)
        self.assertNotEqual(OutgoingOperation.objects.get().claim_id, previous_claim)
        self.assertEqual(OutgoingOperation.objects.count(), 1)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
        self.assertEqual(BlockchainTransaction.objects.filter(status="reverted").count(), 1)
        self.assertEqual(BlockchainTransaction.objects.filter(status="confirmed").count(), 1)

    def test_worker_loaded_before_binding_cannot_reopen_a_peer_revert_without_retry_authority(self):
        admit(self.request, self.actor, confirmed=self.form)
        with tempfile.TemporaryDirectory(prefix="issuance-delayed-binding-") as temporary:
            directory = Path(temporary)
            delayed = self.worker(directory, "delayed_open")
            self.await_file(directory / "open-ready")
            previous_claim, _ = self.reverted(directory)
            (directory / "open").touch()
            self.assertEqual(self.successful(delayed)["status"], "failed")
        self.assertEqual(OutgoingOperation.objects.get().claim_id, previous_claim)
        self.assertEqual(OutgoingOperation.objects.get().status, "reverted")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)
        self.assertEqual(BlockchainTransaction.objects.get().status, "reverted")

    def allotted_subscription(self):
        from unittest.mock import patch

        from offerings.services.subscription import allot
        from offerings.tests.factories import (
            configure_operator,
            eligible_subscriber,
            open_offering,
            paid_subscription,
        )

        configure_operator()
        open_offering(self.tenant, target_shares=200, cap_shares=500)
        eligible_subscriber(self.tenant)
        subscription = paid_subscription(self.tenant, quantity=10)
        with patch("offerings.tasks.allot_subscription_task.defer"):
            self.request = allot(subscription, self.actor, headroom=(1000, 1000))
        self.form = issuance_execution.confirmation(self.request, self.actor, subscription=subscription)
        return subscription

    def test_refund_wins_during_independent_worker_preflight_without_creating_a_mint(self):
        from offerings.services.subscription import record_refund
        from tokens.models import ShareIssuance

        subscription = self.allotted_subscription()
        with tempfile.TemporaryDirectory(prefix="issuance-refund-wins-") as temporary:
            directory = Path(temporary)
            worker = self.worker(directory, "preflight_wait")
            self.await_file(directory / "preflight-ready")
            record_refund(subscription, Decimal("1.00"))
            (directory / "continue").touch()
            self.assertEqual(self.successful(worker)["status"], "rejected")
        self.assertEqual(ShareIssuanceExecution.objects.get().status, "cancelled")
        self.assertFalse(OutgoingOperation.objects.exists())
        self.assertFalse(ShareIssuance.objects.exists())
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, 0)

    def test_independent_worker_claim_survives_death_and_refuses_refund_without_an_operation(self):
        from offerings.exceptions import SubscriptionRefusedException
        from offerings.services.subscription import record_refund

        subscription = self.allotted_subscription()
        with tempfile.TemporaryDirectory(prefix="issuance-claim-wins-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "claimed"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.assertFalse(OutgoingOperation.objects.exists())
            with self.assertRaises(SubscriptionRefusedException):
                record_refund(subscription, Decimal("1.00"))
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "executed")
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, "allotted")
        self.assertIsNone(subscription.refunded_at)
        self.assertEqual(SignedAttempt.objects.count(), 1)
