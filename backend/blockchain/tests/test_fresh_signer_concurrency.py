import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event
from unittest.mock import patch

from django.db import connection, connections
from django.test import TransactionTestCase
from eth_account import Account

from blockchain.exceptions import FreshSignerBootstrapError
from blockchain.models import FreshSignerBootstrap, SigningAccount
from blockchain.services.fresh_signer import bootstrap_fresh_signer
from blockchain.services.outgoing import close_signer_admission
from blockchain.tests.fresh_signer_fixtures import CHAIN_ID, SENDER, FreshSignerFixture


class FreshSignerConcurrencyTest(FreshSignerFixture, TransactionTestCase):
    def run_worker(self, function, pid, ready):
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pid.append(cursor.fetchone()[0])
            ready.set()
            return function()
        finally:
            connections.close_all()

    def wait_for_lock(self, pid):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", [pid])
                if cursor.fetchone() == ("Lock",):
                    return
            time.sleep(0.02)
        self.fail("The competing worker never waited on a real database lock")

    def race(self, first, second, blocked_state):
        locked, release, started = Event(), Event(), Event()
        second_pid = []
        original = SigningAccount.save

        def save(signer, *args, **kwargs):
            if (
                signer.address == SENDER.lower()
                and signer.admission_state == blocked_state
                and signer.admission_generation == 1
            ):
                locked.set()
                if not release.wait(15):
                    raise RuntimeError("Synthetic lock coordination timed out")
            return original(signer, *args, **kwargs)

        with patch.object(SigningAccount, "save", save), ThreadPoolExecutor(max_workers=2) as pool:
            first_result = pool.submit(self.run_worker, first, [], Event())
            try:
                self.assertTrue(locked.wait(10))
                second_result = pool.submit(self.run_worker, second, second_pid, started)
                self.assertTrue(started.wait(5))
                self.wait_for_lock(second_pid[0])
            finally:
                release.set()
            return first_result.result(timeout=15), second_result

    def test_close_waits_for_bootstrap_commit_then_closes_its_new_generation(self):
        SigningAccount.objects.create(chain_id=CHAIN_ID, address=SENDER.lower())
        first, second = self.race(
            lambda: bootstrap_fresh_signer(self.manifest),
            lambda: close_signer_admission(chain_id=CHAIN_ID, sender=SENDER),
            "admitted",
        )
        self.assertFalse(first["unchanged"])
        self.assertEqual(second.result(), 2)
        signer = SigningAccount.objects.get()
        self.assertEqual((signer.admission_state, signer.admission_generation, signer.next_nonce), ("closed", 2, 5))
        self.assertEqual(FreshSignerBootstrap.objects.count(), 1)
        with self.assertRaisesMessage(FreshSignerBootstrapError, "cannot be reopened"):
            bootstrap_fresh_signer(self.manifest)

    def test_bootstrap_waiting_for_closure_cannot_reopen_the_signer(self):
        SigningAccount.objects.create(chain_id=CHAIN_ID, address=SENDER.lower())
        first, second = self.race(
            lambda: close_signer_admission(chain_id=CHAIN_ID, sender=SENDER),
            lambda: bootstrap_fresh_signer(self.manifest),
            "closed",
        )
        self.assertEqual(first, 1)
        with self.assertRaisesMessage(FreshSignerBootstrapError, "generation zero"):
            second.result()
        signer = SigningAccount.objects.get()
        self.assertEqual((signer.admission_state, signer.admission_generation, signer.next_nonce), ("closed", 1, 0))
        self.assertFalse(FreshSignerBootstrap.objects.exists())
        self.chain.get_transaction.assert_not_called()

    def test_different_signer_bootstraps_serialize_the_globally_fresh_database(self):
        other = deepcopy(self.manifest)
        other["operator_address"] = Account.from_key("0x" + "22" * 32).address
        other["environment_id"] = "synthetic-second-isolated-environment"
        with patch("blockchain.services.fresh_signer._configuration"), patch(
            "blockchain.services.fresh_signer._chain_evidence", return_value={"synthetic_concurrency": True}
        ):
            first, second = self.race(
                lambda: bootstrap_fresh_signer(self.manifest), lambda: bootstrap_fresh_signer(other), "admitted"
            )
        self.assertFalse(first["unchanged"])
        with self.assertRaisesMessage(FreshSignerBootstrapError, "existing outgoing"):
            second.result()
        self.assertEqual(SigningAccount.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().address, SENDER.lower())
        self.assertEqual(FreshSignerBootstrap.objects.count(), 1)
