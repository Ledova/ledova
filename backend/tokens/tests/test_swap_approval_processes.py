import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import SignedAttempt, SigningAccount
from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from tokens.services import swap_approval
from tokens.tests.deployment_fixtures import CHAIN_ID, FACTORY, KEY
from tokens.tests.swap_approval_fixtures import SWAP, install_approval


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    ATOMIC_SWAP_ADDRESS=SWAP,
)
class SwapApprovalProcessTest(TransactionTestCase):
    def setUp(self):
        install_approval(self)

    def worker(self, directory, phase, *extra):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["APPROVAL_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        return subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tokens.tests.swap_approval_worker",
                str(directory),
                phase,
                str(self.command.pk),
                *map(str, extra),
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def attempts(self):
        return SignedAttempt.objects.filter(operation__operation_key=f"swap-approval:{self.command.pk}")

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="swap-approval-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.assertEqual(self.attempts().count(), int(signed))
            original = self.attempts().first()
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "confirmed")
            self.command.refresh_from_db()
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "deployed")
            self.assertEqual(self.attempts().count(), 1)
            attempt = self.attempts().get()
            self.assertEqual(self.command.approval_transaction.tx_hash, attempt.tx_hash)
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original.tx_hash, bytes(original.raw_transaction), original.nonce),
                )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 9)

    def test_kill_after_signing_decision_recovers_admitted_approval(self):
        self.recover_killed("decided", False)

    def test_kill_after_open_before_binding_recovers_original_operation(self):
        self.recover_killed("opened", False)

    def test_kill_before_signed_commit_rolls_back_bytes_and_nonce(self):
        self.recover_killed("before_commit", False)

    def test_kill_after_signed_commit_recovers_original_bytes(self):
        self.recover_killed("signed", True)

    def test_kill_after_provider_acceptance_recovers_original_receipt_without_send(self):
        self.recover_killed("accepted", True)

    def test_kill_after_revert_receipt_retains_it_before_retry(self):
        with tempfile.TemporaryDirectory(prefix="swap-approval-revert-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "reverted"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.command.refresh_from_db()
            self.assertEqual(self.command.approval_operation.status, "reverted")
            self.assertEqual(self.command.approval_transaction.status, "submitted")
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "failed")
            self.command.refresh_from_db()
            self.assertEqual(self.command.approval_transaction.status, "reverted")
            self.assertEqual(self.command.approval_transaction.block_hash, self.command.approval_operation.block_hash)
            self.assertEqual(self.attempts().count(), 1)

    def test_independent_workers_share_one_attempt_and_nonce(self):
        self.race()
        self.assertEqual(self.attempts().count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)

    def race(self, phase="race", *extra):
        with tempfile.TemporaryDirectory(prefix="swap-approval-race-") as temporary:
            directory = Path(temporary)
            processes = [self.worker(directory, phase, *extra) for _ in range(2)]
            try:
                until = time.monotonic() + 20
                while len(list(directory.glob("ready-*"))) != 2 and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertEqual(len(list(directory.glob("ready-*"))), 2)
                (directory / "go").touch()
                for process in processes:
                    code, out, err = finish(process)
                    self.assertEqual(code, 0, out + err)
                    self.assertIn(json.loads(out)["status"], ("executing", "confirmed"))
                self.command.refresh_from_db()
                self.assertEqual(self.command.approval_outcome, "confirmed")
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_competing_retry_confirmations_admit_one_fresh_claim_and_job(self):
        self.approval_node.receipt_status = 0
        self.assertEqual(swap_approval.recover(self.command.pk), "failed")
        actor = get_user_model().objects.create_superuser(email="race@example.com", password="test")
        confirmation = swap_approval.retry_confirmation(self.token, actor)
        self.race("retry_race", actor.pk, confirmation)
        self.assertEqual(self.attempts().count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 10)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'deployment_id'=%s",
                ["tokens.tasks.deployment.recover_swap_approval", str(self.command.pk)],
            )
            self.assertEqual(cursor.fetchone()[0], 2)

    def test_stale_true_observer_cannot_replace_a_peer_signed_approval(self):
        with tempfile.TemporaryDirectory(prefix="swap-approval-observation-") as temporary:
            directory = Path(temporary)
            observer = self.worker(directory, "observe_true")
            try:
                until = time.monotonic() + 20
                while not (directory / "observation-ready").exists() and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertTrue((directory / "observation-ready").exists())
                code, out, err = finish(self.worker(directory, "recover"))
                self.assertEqual(code, 0, out + err)
                self.assertEqual(json.loads(out)["status"], "confirmed")
                (directory / "release-observation").touch()
                code, out, err = finish(observer)
                self.assertEqual(code, 0, out + err)
                self.assertEqual(json.loads(out)["status"], "confirmed")
                self.command.refresh_from_db()
                self.assertIsNone(self.command.approval_observation)
                self.assertEqual(self.attempts().count(), 1)
            finally:
                if observer.poll() is None:
                    observer.kill()
                    observer.communicate()
