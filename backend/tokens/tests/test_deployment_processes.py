import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from django.db import connections
from django.test import TransactionTestCase, override_settings

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from tokens.services import deployment
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    DeploymentNode,
    admitted_signer,
    deployment_token,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class DeploymentProcessTest(TransactionTestCase):
    def setUp(self):
        self.token = deployment_token("process-deployment").token
        admitted_signer()

    def worker(self, directory, phase, retry_of=None):
        settings = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["DEPLOYMENT_TEST_DATABASE"] = json.dumps({key: settings[key] for key in fields})
        args = [sys.executable, "-m", "tokens.tests.deployment_worker", str(directory), phase, str(self.token.pk)]
        if retry_of:
            args.append(str(retry_of))
        return subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="deployment-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.token.refresh_from_db()
            self.assertIsNotNone(self.token.deployment_id)
            self.assertEqual(SignedAttempt.objects.count(), int(signed))
            original = SignedAttempt.objects.values("tx_hash", "raw_transaction", "nonce").first()
            if original:
                self.assertEqual(SigningAccount.objects.get().next_nonce, original["nonce"] + 1)
            else:
                self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], CREATED)
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "deployed")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(OutgoingOperation.objects.count(), 1)
            attempt = SignedAttempt.objects.get()
            self.assertEqual(self.token.deployment_transaction.tx_hash, attempt.tx_hash)
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

    def test_kill_before_projection_recovers_the_original_receipt(self):
        self.recover_killed("before_projection", True)

    def test_kill_after_node_acceptance_recovers_without_another_send(self):
        self.recover_killed("accepted", True)

    def race(self, retry_of=None):
        with tempfile.TemporaryDirectory(prefix="deployment-race-") as temporary:
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
                    self.assertIn(json.loads(out)["status"], (None, CREATED))
                ledger = json.loads((directory / "node.json").read_text())
                self.assertEqual(len(ledger["hashes"]), 1)
                self.assertEqual(len(set(ledger["broadcasts"])), 1)
                self.token.refresh_from_db()
                self.assertEqual(self.token.status, "deployed")
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
        node = DeploymentNode()
        node.receipt_status = 0
        with patch("tokens.services.deployment.get_base_chain_client", return_value=node.client):
            deployment.deploy_token(self.token)
        self.race(OutgoingOperation.objects.get().claim_id)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
