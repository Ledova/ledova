import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import SignedAttempt, SigningAccount
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from blockchain.tests.test_outgoing_processes import finish
from companies.models import Company
from shared.db import atomic, current_alias
from tokens.models import ShareToken
from tokens.services import pause_changes
from tokens.tests.pause_fixtures import install_pause


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class PauseProcessTest(TransactionTestCase):
    def setUp(self):
        install_pause(self)

    def worker(self, directory, phase, *extra):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["PAUSE_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        return subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tokens.tests.pause_worker",
                str(directory),
                phase,
                str(self.change.pk),
                *map(str, extra),
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def attempts(self):
        return SignedAttempt.objects.filter(operation__operation_key=f"token-pause:{self.change.pk}")

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="pause-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.assertEqual(self.attempts().count(), int(signed))
            original = self.attempts().first()
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "confirmed")
            self.change.refresh_from_db()
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "paused")
            self.assertEqual(self.attempts().count(), 1)
            attempt = self.attempts().get()
            self.assertEqual(self.change.operation.current_attempt.tx_hash, attempt.tx_hash)
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original.tx_hash, bytes(original.raw_transaction), original.nonce),
                )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_kill_after_signing_decision_recovers_admitted_pause(self):
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
        with tempfile.TemporaryDirectory(prefix="pause-revert-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "reverted"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.change.refresh_from_db()
            self.assertEqual(self.change.operation.status, "reverted")
            self.assertEqual(self.change.status, "executing")
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "failed")
            self.change.refresh_from_db()
            self.assertEqual(self.change.status, "failed")
            self.assertIsNotNone(self.change.completed_at)
            self.assertEqual(self.attempts().count(), 1)

    def test_independent_workers_share_one_attempt_and_nonce(self):
        self.race()
        self.assertEqual(self.attempts().count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def race(self, phase="race", *extra):
        with tempfile.TemporaryDirectory(prefix="pause-race-") as temporary:
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
                self.change.refresh_from_db()
                self.assertEqual(self.change.status, "confirmed")
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_stale_true_observer_cannot_replace_a_peer_signed_pause(self):
        with tempfile.TemporaryDirectory(prefix="pause-observation-") as temporary:
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
                self.change.refresh_from_db()
                self.assertIsNone(self.change.observation)
                self.assertEqual(self.attempts().count(), 1)
            finally:
                if observer.poll() is None:
                    observer.kill()
                    observer.communicate()

    def test_kill_after_outcome_retains_barrier_until_projection_finishes(self):
        self.recover_killed("outcome", True)

    def test_kill_after_completion_replays_without_touching_token_or_signer(self):
        self.recover_killed("completed", True)

    def revoke_during_target_wait(self, revoke):
        with tempfile.TemporaryDirectory(prefix="pause-authority-") as temporary:
            directory = Path(temporary)
            process = self.worker(directory, "sign_wait")
            try:
                until = time.monotonic() + 20
                while not (directory / "sign-ready").exists() and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertTrue((directory / "sign-ready").exists())
                process_id = int((directory / "sign-ready").read_text())
                with atomic():
                    Company.objects.select_for_update().get(pk=self.change.company_id)
                    (directory / "sign-go").touch()
                    blocked = False
                    until = time.monotonic() + 15
                    with connections[current_alias()].cursor() as cursor:
                        while time.monotonic() < until:
                            cursor.execute("SELECT pg_stat_clear_snapshot()")
                            cursor.execute(
                                "SELECT wait_event_type, query FROM pg_stat_activity WHERE pid=%s", [process_id]
                            )
                            observed = cursor.fetchone()
                            if observed and observed[0] == "Lock" and "companies_company" in observed[1]:
                                blocked = True
                                break
                            time.sleep(0.01)
                    self.assertTrue(blocked, "The signing callback must actually wait on the target row")
                    revoke()
                code, out, err = finish(process)
                self.assertEqual(code, 0, out + err)
                self.assertEqual(json.loads(out), {"status": "failed", "completed": True})
                self.assertFalse(self.attempts().exists())
                self.assertFalse((directory / "node.json").exists())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_actor_deactivated_while_signing_waits_cannot_use_the_earlier_authority_read(self):
        self.revoke_during_target_wait(
            lambda: get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_active=False)
        )

    def test_staff_permission_revoked_while_signing_waits_is_rechecked_after_the_lock(self):
        actor = get_user_model().objects.create_user(email="pause-staff@example.test", is_staff=True, is_active=True)
        permission = Permission.objects.get(codename="change_sharetoken")
        actor.user_permissions.add(permission)
        token = ShareToken.objects.create(
            company=self.token.company,
            name="Second token",
            symbol="TWO",
            total_supply="100",
            status="deployed",
            chain="base",
            contract_address="0x" + "e" * 40,
        )
        self.change = pause_changes.submit(token, actor, uuid4(), True, authority="staff")
        self.revoke_during_target_wait(lambda: actor.user_permissions.remove(permission))
