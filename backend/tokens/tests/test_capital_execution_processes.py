import json
import os
import signal
import subprocess
import sys
import tempfile
import time
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
from tokens.models import CapitalIncreaseExecution
from tokens.services import capital_execution
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit, capital_request


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class CapitalExecutionProcessTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.actor = capital_request("capital-process")
        self.request = self.tenant.capital_increase
        self.form = capital_execution.confirmation(self.request, self.actor)
        admitted_signer()

    def worker(self, directory, phase, form=None):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["CAPITAL_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        args = [
            sys.executable,
            "-m",
            "tokens.tests.capital_worker",
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
        with tempfile.TemporaryDirectory(prefix="capital-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "executing")
            self.assertEqual(CapitalIncreaseExecution.objects.count(), 1)
            self.assertEqual(SignedAttempt.objects.count(), int(signed))
            if phase == "opened":
                self.assertIsNone(CapitalIncreaseExecution.objects.get().operation_id)
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
        with tempfile.TemporaryDirectory(prefix="capital-race-") as temporary:
            directory = Path(temporary)
            processes = [self.worker(directory, "race") for _ in range(2)]
            for process in processes:
                self.await_file(directory / f"ready-{process.pid}")
            (directory / "go").touch()
            for process in processes:
                self.assertIn(self.successful(process)["status"], ("executing", "executed"))
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)
        self.assertIsNone(CapitalIncreaseExecution.objects.get().attribution_evidence)

    def test_delayed_preflight_cannot_hold_the_original_transaction_mined_by_a_peer(self):
        admit(self.request, self.actor, confirmed=self.form)
        with tempfile.TemporaryDirectory(prefix="capital-peer-receipt-") as temporary:
            directory = Path(temporary)
            delayed = self.worker(directory, "delayed_preflight")
            self.await_file(directory / "preflight-ready")
            winner = self.worker(directory, "mined_before_projection")
            self.await_file(directory / "mined")
            try:
                self.assertEqual(self.successful(delayed)["status"], "executed")
                self.assertIsNone(CapitalIncreaseExecution.objects.get().attribution_evidence)
            finally:
                (directory / "finish-projection").touch()
            self.assertEqual(self.successful(winner)["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")

    def test_kill_before_revert_projection_retains_receipt_and_needs_new_retry_confirmation(self):
        with tempfile.TemporaryDirectory(prefix="capital-revert-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "before_revert_projection"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            previous = BlockchainTransaction.objects.get()
            self.assertEqual(previous.status, "submitted")
            claim = OutgoingOperation.objects.get().claim_id
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "failed")
            previous.refresh_from_db()
            self.assertEqual(previous.status, "reverted")
            self.assertEqual(self.successful(self.worker(directory, "execute"))["status"], "failed")
            retry = capital_execution.confirmation(self.request, self.actor)
            self.assertEqual(self.successful(self.worker(directory, "execute", retry))["status"], "executed")
            self.assertNotEqual(OutgoingOperation.objects.get().claim_id, claim)
            self.assertEqual(SignedAttempt.objects.count(), 2)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
            previous.refresh_from_db()
            self.assertEqual(previous.status, "reverted")

    def test_kill_after_attribution_commit_preserves_hold_when_chain_cap_is_restored(self):
        with tempfile.TemporaryDirectory(prefix="capital-attribution-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "attributed"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            evidence = CapitalIncreaseExecution.objects.get().attribution_evidence
            self.assertEqual(evidence["source"], "chain")
            result = self.successful(self.worker(directory, "recover"))
            self.assertEqual(result["status"], "executing")
            self.assertTrue(result["attribution_required"])
            self.assertEqual(CapitalIncreaseExecution.objects.get().attribution_evidence, evidence)
            self.assertFalse(SignedAttempt.objects.exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
            self.assertFalse((directory / "node.json").exists())

    def reverted(self, directory):
        code, out, err = finish(self.worker(directory, "before_revert_projection"))
        self.assertEqual(code, -signal.SIGKILL, out + err)
        self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "failed")
        return OutgoingOperation.objects.get().claim_id, capital_execution.confirmation(self.request, self.actor)

    def test_kill_after_explicit_retry_admission_recovers_the_authorized_claim(self):
        with tempfile.TemporaryDirectory(prefix="capital-admitted-retry-") as temporary:
            directory = Path(temporary)
            previous_claim, retry = self.reverted(directory)
            code, out, err = finish(self.worker(directory, "admitted", retry))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            command = CapitalIncreaseExecution.objects.get()
            self.assertEqual(command.retry_of, previous_claim)
            self.assertIsNone(command.projected_at)
            self.assertEqual(command.operation.claim_id, previous_claim)
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "executing")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(self.successful(self.worker(directory, "recover"))["status"], "executed")
            self.assertNotEqual(OutgoingOperation.objects.get().claim_id, previous_claim)
            self.assertEqual(SignedAttempt.objects.count(), 2)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
            self.assertEqual(BlockchainTransaction.objects.filter(status="reverted").count(), 1)

    def test_independent_explicit_retry_workers_share_one_new_claim_and_nonce(self):
        with tempfile.TemporaryDirectory(prefix="capital-retry-race-") as temporary:
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
        with tempfile.TemporaryDirectory(prefix="capital-delayed-binding-") as temporary:
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
