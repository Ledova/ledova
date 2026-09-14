import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from tokens.exceptions import MintRequestConflict
from tokens.services import mint_service
from tokens.tests.mint_request_fixtures import (
    CHAIN_ID,
    KEY,
    MintNode,
    admitted_signer,
    mint_request,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class MintRequestProcessTest(TransactionTestCase):
    def setUp(self):
        self.actor = get_user_model().objects.create_superuser(email="process-mint@example.test", password="synthetic")
        self.request = mint_request(self.actor)
        admitted_signer()

    def worker(self, directory, phase, retry_of=None):
        settings = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["MINT_TEST_DATABASE"] = json.dumps({key: settings[key] for key in fields})
        args = [sys.executable, "-m", "tokens.tests.mint_request_worker", str(directory), phase, str(self.request.pk)]
        if retry_of:
            args.append(str(retry_of))
        return subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="mint-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.request.refresh_from_db()
            self.assertIsNotNone(self.request.execution_intent)
            self.assertEqual(SignedAttempt.objects.count(), int(signed))
            original = SignedAttempt.objects.values("tx_hash", "raw_transaction", "nonce").first()
            if original:
                self.assertEqual(SigningAccount.objects.get().next_nonce, original["nonce"] + 1)
            else:
                self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "executed")
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "executed")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(OutgoingOperation.objects.count(), 1)
            attempt = SignedAttempt.objects.get()
            self.assertEqual(self.request.transaction.tx_hash, attempt.tx_hash)
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original["tx_hash"], bytes(original["raw_transaction"]), original["nonce"]),
                )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_kill_after_admission_recovers_the_committed_request(self):
        self.recover_killed("admitted", False)

    def test_kill_before_signed_commit_rolls_back_the_nonce_and_recovers(self):
        self.recover_killed("before_commit", False)

    def test_kill_after_signed_commit_recovers_the_original_payload(self):
        self.recover_killed("signed", True)

    def test_kill_after_node_acceptance_recovers_without_another_send(self):
        self.recover_killed("accepted", True)

    def race(self, retry_of=None):
        with tempfile.TemporaryDirectory(prefix="mint-race-") as temporary:
            directory = Path(temporary)
            processes = [self.worker(directory, "race", retry_of) for _ in range(2)]
            try:
                until = time.monotonic() + 20
                while len(list(directory.glob("ready-*"))) != 2 and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertEqual(len(list(directory.glob("ready-*"))), 2)
                (directory / "go").touch()
                for process in processes:
                    code, out, err = finish(process)
                    self.assertEqual(code, 0, out + err)
                    self.assertIn(json.loads(out)["status"], ("executing", "executed"))
                ledger = json.loads((directory / "node.json").read_text())
                self.assertEqual(len(ledger["hashes"]), 1)
                self.assertEqual(len(set(ledger["broadcasts"])), 1)
                self.request.refresh_from_db()
                self.assertEqual(self.request.status, "executed")
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_independent_workers_executing_one_request_share_one_signed_attempt(self):
        self.race()
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_independent_retry_forms_authorize_only_one_fresh_attempt(self):
        node = MintNode()
        node.receipt_status = 0
        with patch("tokens.services.mint_service.get_base_chain_client", return_value=node.client), self.assertRaises(
            MintRequestConflict
        ):
            mint_service.execute(self.request, self.actor)
        self.race(OutgoingOperation.objects.get().claim_id)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
