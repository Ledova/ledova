import json
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase, override_settings
from web3 import Web3

from blockchain.tests.test_outgoing_processes import finish
from shared.db import current_alias
from tokens.models import SwapApprovalSubmission
from tokens.tests.swap_approval_submission_fixtures import approval_bytes
from tokens.tests.swap_state_fixtures import CONTRACT, make_swap


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapApprovalSubmissionProcessTest(TransactionTestCase):
    def setUp(self):
        self.swap = make_swap("approval-process")
        self.actor = self.swap.sell_order.owner_account.user_profile.user
        self.raw = approval_bytes(self.swap)
        self.tx_hash = Web3.keccak(self.raw).to_0x_hex()

    def worker(self, directory, phase):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["APPROVAL_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        env["APPROVAL_TEST_SETTINGS"] = json.dumps(
            {"ATOMIC_SWAP_ADDRESS": CONTRACT, "BLOCKCHAIN_CHAIN_ID": settings.BLOCKCHAIN_CHAIN_ID}
        )
        return subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tokens.tests.swap_approval_submission_worker",
                str(directory),
                phase,
                str(self.swap.pk),
                str(self.actor.pk),
                self.raw.hex(),
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def ledger(self, directory):
        path = directory / "node.json"
        return json.loads(path.read_text()) if path.exists() else {"broadcasts": [], "mined": []}

    def crashed_then_recovered(self, phase, *, acknowledged, sent_before, recoveries):
        with tempfile.TemporaryDirectory(prefix="swap-approval-submission-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            row = SwapApprovalSubmission.objects.get(tx_hash=self.tx_hash)
            self.assertEqual(
                (row.outcome, row.acknowledged_at is not None, bytes(row.raw_transaction), row.nonce),
                ("pending", acknowledged, self.raw, 0),
            )
            self.assertEqual(self.ledger(directory)["broadcasts"], [Web3.to_hex(self.raw)] * sent_before)
            outcomes = []
            for _ in recoveries:
                code, out, err = finish(self.worker(directory, "recover"))
                self.assertEqual(code, 0, out + err)
                outcomes.append(json.loads(out)["outcome"])
            self.assertEqual(outcomes, list(recoveries))
            row.refresh_from_db()
            self.assertEqual((row.outcome, row.block_number, row.gas_used), ("confirmed", 7, 21000))
            self.assertEqual(self.ledger(directory)["broadcasts"], [Web3.to_hex(self.raw)])
            self.assertEqual(SwapApprovalSubmission.objects.count(), 1)

    def test_kill_after_row_commit_before_send_replays_the_recorded_bytes_once(self):
        self.crashed_then_recovered(
            "committed", acknowledged=False, sent_before=0, recoveries=("acknowledged", "confirmed")
        )

    def test_kill_after_node_acceptance_before_acknowledgement_finds_the_receipt_without_a_resend(self):
        self.crashed_then_recovered("accepted", acknowledged=False, sent_before=1, recoveries=("confirmed",))

    def test_kill_after_receipt_before_record_records_it_on_recovery_without_a_resend(self):
        self.crashed_then_recovered("received", acknowledged=True, sent_before=1, recoveries=("confirmed",))
