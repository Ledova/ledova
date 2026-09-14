import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from whitelist.models import WhitelistChange
from whitelist.tests.change_fixtures import (
    CHAIN_ID,
    KEY,
    REGISTRY,
    admitted_signer,
    change_actor,
    change_entry,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, WHITELIST_CONTRACT_ADDRESS=REGISTRY)
class WhitelistChangeProcessTest(TransactionTestCase):
    def setUp(self):
        self.actor = change_actor()
        self.entry = change_entry()
        self.submission_id = uuid4()
        admitted_signer()

    def worker(self, directory, phase, submission_id=None, action="add"):
        settings = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["WHITELIST_TEST_DATABASE"] = json.dumps({key: settings[key] for key in fields})
        args = [
            sys.executable,
            "-m",
            "whitelist.tests.change_worker",
            str(directory),
            phase,
            str(self.actor.pk),
            str(submission_id or self.submission_id),
            action,
        ]
        return subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="whitelist-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.assertEqual(WhitelistChange.objects.count(), 1)
            self.assertEqual(SignedAttempt.objects.count(), int(signed))
            original = SignedAttempt.objects.values("tx_hash", "raw_transaction", "nonce").first()
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "confirmed")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(OutgoingOperation.objects.count(), 1)
            change = WhitelistChange.objects.get()
            attempt = SignedAttempt.objects.get()
            self.assertEqual(change.transaction.tx_hash, attempt.tx_hash)
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original["tx_hash"], bytes(original["raw_transaction"]), original["nonce"]),
                )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_kill_after_admission_recovers_the_accepted_command(self):
        self.recover_killed("admitted", False)

    def test_kill_before_signed_commit_rolls_back_nonce_and_attempt(self):
        self.recover_killed("before_commit", False)

    def test_kill_after_signed_commit_recovers_original_bytes(self):
        self.recover_killed("signed", True)

    def test_kill_after_accepted_send_reconciles_without_another_broadcast(self):
        self.recover_killed("accepted", True)

    def test_kill_after_terminal_projection_returns_original_outcome(self):
        self.recover_killed("projected", True)

    def race(self, *, distinct=False, opposite=False):
        with tempfile.TemporaryDirectory(prefix="whitelist-race-") as temporary:
            directory = Path(temporary)
            submissions = [self.submission_id, uuid4() if distinct else self.submission_id]
            if opposite:
                code, out, err = finish(self.worker(directory, "signed"))
                self.assertEqual(code, -signal.SIGKILL, out + err)
            processes = [
                self.worker(directory, "race_pending", submission, "remove" if opposite and index else "add")
                for index, submission in enumerate(submissions)
            ]
            try:
                until = time.monotonic() + 20
                while len(list(directory.glob("ready-*"))) != 2 and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertEqual(len(list(directory.glob("ready-*"))), 2)
                (directory / "go").touch()
                outcomes = []
                for process in processes:
                    code, out, err = finish(process)
                    self.assertEqual(code, 0, out + err)
                    outcomes.append(json.loads(out)["status"])
                self.assertEqual(
                    sorted(outcomes), ["conflict", "executing"] if distinct else ["executing", "executing"]
                )
                self.assertEqual(WhitelistChange.objects.count(), 1)
                self.assertEqual(SignedAttempt.objects.count(), 1)
                ledger = json.loads((directory / "node.json").read_text())
                self.assertEqual(len(ledger["hashes"]), 1)
                self.assertEqual(len(set(ledger["broadcasts"])), 1)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_identical_concurrent_submissions_share_one_signed_attempt(self):
        self.race()

    def test_distinct_concurrent_submissions_cannot_both_own_the_target(self):
        self.race(distinct=True)

    def test_opposite_process_cannot_admit_while_original_process_recovers(self):
        self.race(distinct=True, opposite=True)
