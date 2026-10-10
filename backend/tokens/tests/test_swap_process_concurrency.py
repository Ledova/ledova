import json
import os
import select
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.db import connection
from django.test import TransactionTestCase, override_settings
from eth_account.messages import encode_typed_data

from shared.db import use_operator
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.process_readiness import WORKER_START_TIMEOUT
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import SwapOrder, SwapOrderStatus
from tokens.tests.order_process_fixtures import worker_databases
from tokens.tests.swap_state_fixtures import (
    BUYER,
    CONTRACT,
    SELLER,
    make_swap,
    swap_service,
)


class SwapProcess:

    def __init__(self, test, mode, row_id, detail=""):
        self.test = test
        self.pending_output = b""
        with use_operator():
            owner = SwapOrder.objects.get(pk=row_id).sell_order.owner_account
            user_id = owner.user_profile.user_id
        self.errors = tempfile.TemporaryFile()
        self.process = subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.swap_state_worker", mode, str(row_id), detail],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.errors,
            bufsize=0,
            env={
                **os.environ,
                "DJANGO_SETTINGS_MODULE": "ledova_backend.settings.test_postgres",
                "TRADING_TEST_DATABASES": json.dumps(worker_databases(), default=str),
                "TRADING_TEST_CHAIN_ID": str(settings.BLOCKCHAIN_CHAIN_ID),
                "TRADING_TEST_USER": str(user_id),
                "TRADING_TEST_PRIVATE_MEDIA_ROOT": str(settings.PRIVATE_MEDIA_ROOT),
            },
        )
        test.addCleanup(self.close)
        loaded = self.receive("loaded", timeout=WORKER_START_TIMEOUT)
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid()")
            test.assertNotEqual(loaded["pid"], cursor.fetchone()[0])
        self.database_pid = loaded["pid"]
        test.assertEqual(loaded["private_media_root"], str(settings.PRIVATE_MEDIA_ROOT))

    def error_output(self):
        self.errors.seek(0)
        return self.errors.read().decode()[-5000:]

    def receive(self, stage, timeout=25):
        deadline = time.monotonic() + timeout

        def refused(reason):
            self.test.fail(
                f"{self.test.id()}: worker {self.process.pid} did not reach {stage}; "
                f"exit={self.process.poll()}; {reason}; stderr={self.error_output()}"
            )

        while b"\n" not in self.pending_output:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                refused(f"timed out with incomplete message {self.pending_output[-500:]!r}")
            readable, _, _ = select.select([self.process.stdout], [], [], remaining)
            if not readable:
                refused(f"timed out with incomplete message {self.pending_output[-500:]!r}")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                refused(f"EOF with incomplete message {self.pending_output[-500:]!r}")
            self.pending_output += chunk
        line, self.pending_output = self.pending_output.split(b"\n", 1)
        try:
            event = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            refused(f"invalid JSON: {error}; message={line[-500:]!r}")
        if not isinstance(event, dict) or type(event.get("pid")) is not int or event["pid"] <= 0:
            refused(f"invalid worker event: {event!r}")
        if event.get("stage") != stage:
            refused(f"unexpected worker event: {event!r}")
        self.database_pid = event["pid"]
        return event

    def send(self, command):
        self.process.stdin.write((command + "\n").encode())
        self.process.stdin.flush()

    def done(self):
        result = self.receive("done")
        self.test.assertEqual(self.process.wait(timeout=10), 0, self.error_output())
        return result

    def refused(self):
        event = self.receive("error")
        self.test.assertEqual(self.process.wait(timeout=10), 1, self.error_output())
        return event["refused"]

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()
        self.errors.close()


@skipUnless(connection.vendor == "postgresql", "Independent processes require PostgreSQL row locks")
@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
class SwapWorkersUseOneCurrentClaimTest(TransactionTestCase):

    def setUp(self):
        self.swap = make_swap("process-swap")
        with use_operator():
            account = self.swap.sell_order.owner_account
            accept_company_eligibility(
                SimpleNamespace(
                    user=account.user_profile.user,
                    profile=account.user_profile,
                    account=account,
                    company=self.swap.share_token.company,
                )
            )
        for path in (
            "tokens.services.swap_execution.publish_trading_event",
            "tokens.events.publish_trading_event",
        ):
            publisher = patch(path)
            publisher.start()
            self.addCleanup(publisher.stop)

    def wait_for_row_lock(self, child, table, blocker_pid=None, *, admission_target=None):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_stat_clear_snapshot()")
                cursor.execute(
                    "SELECT query, COALESCE(%s, pg_backend_pid()) = ANY(pg_blocking_pids(pid)), wait_event_type "
                    "FROM pg_stat_activity WHERE pid = %s",
                    [blocker_pid, child.database_pid],
                )
                observed = cursor.fetchone()
            if (
                observed
                and observed[1]
                and observed[0].startswith("SELECT ")
                and (
                    (
                        observed[0].startswith("SELECT public.tokens_lock_trading_admission(")
                        and f'"target_uuid": "{admission_target}"' in observed[0]
                    )
                    if admission_target is not None
                    else table in observed[0]
                )
                and observed[2] == "Lock"
            ):
                return
            time.sleep(0.01)
        self.fail(f"Worker never waited for the held {table} row: {observed}")

    def test_opposite_verified_signatures_recompute_ready_after_the_other_commits(self):
        seller = SwapProcess(self, "signature", self.swap.pk, "seller")
        buyer = SwapProcess(self, "signature", self.swap.pk, "buyer")
        seller.send("run")
        buyer.send("run")
        self.assertTrue(seller.receive("verified")["valid"])
        self.assertTrue(buyer.receive("verified")["valid"])
        seller.send("store")
        seller.receive("locking")
        seller.done()
        buyer.send("store")
        buyer.receive("locking")
        self.assertEqual(buyer.done()["result"], SwapOrderStatus.READY)
        self.swap.refresh_from_db()
        signable = encode_typed_data(full_message=swap_service(self).get_typed_data(self.swap))
        self.assertEqual(self.swap.seller_signature, "0x" + SELLER.sign_message(signable).signature.hex())
        self.assertEqual(self.swap.buyer_signature, "0x" + BUYER.sign_message(signable).signature.hex())

    def test_an_overlapping_signature_waits_and_reads_the_committed_other_signature(self):
        seller = SwapProcess(self, "signature_overlap", self.swap.pk, "seller")
        buyer = SwapProcess(self, "signature", self.swap.pk, "buyer")
        seller.send("run")
        buyer.send("run")
        seller.receive("verified")
        buyer.receive("verified")
        seller.send("store")
        self.assertTrue(seller.receive("signature_locked")["in_atomic"])
        buyer.send("store")
        buyer.receive("locking")
        self.wait_for_row_lock(buyer, "tokens_sharetoken", seller.database_pid)
        seller.send("signature")
        self.assertEqual(seller.done()["result"], SwapOrderStatus.SELLER_SIGNED)
        self.assertEqual(buyer.done()["result"], SwapOrderStatus.READY)
        self.swap.refresh_from_db()
        self.assertTrue(self.swap.seller_signature)
        self.assertTrue(self.swap.buyer_signature)


@skipUnless(connection.vendor == "postgresql", "Requires independent PostgreSQL row locks")
@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
class ScopedSwapWorkersUseOneCurrentClaimTest(RunsOnTheScopedConnection, SwapWorkersUseOneCurrentClaimTest):
    def setUp(self):
        super().setUp()
        with use_operator():
            user = self.swap.sell_order.owner_account.user_profile.user
        self.the_principal_the_middleware_would_set(user)
        self.addCleanup(self.no_principal_is_set)
