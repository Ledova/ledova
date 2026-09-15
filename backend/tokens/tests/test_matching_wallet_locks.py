from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch
from uuid import uuid4

from django.db import connections
from rest_framework.test import APIClient, APITransactionTestCase

from shared.db import current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import a_profile
from tokens.services import token_transfer_service
from tokens.tests.order_submission_fixtures import BASE, SubmissionFixtures
from users.models import UserAccount
from wallets.models import Wallet


class ScopedMatchingWalletLockTest(RunsOnTheScopedConnection, SubmissionFixtures, APITransactionTestCase):
    def assert_authorization_change_waits_for_submission(self, change):
        body = self.signed_body()
        paused = Event()
        release = Event()
        writer_ready = Event()
        pids = {}
        find_matching = token_transfer_service.find_matching_order

        def before_matching(service, order):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pids["submission"] = cursor.fetchone()[0]
            paused.set()
            if not release.wait(10):
                raise AssertionError("The test did not release the admitted submission")
            return find_matching(service, order)

        def create():
            try:
                client = APIClient()
                client.force_authenticate(self.tenant.user)
                return client.post(f"{BASE}create/", body, format="json").status_code
            finally:
                connections.close_all()

        def update_authorization():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["writer"] = cursor.fetchone()[0]
                    writer_ready.set()
                    return change()
            finally:
                connections.close_all()

        with patch.object(token_transfer_service, "find_matching_order", before_matching), ThreadPoolExecutor(
            2
        ) as pool:
            submitting = pool.submit(create)
            try:
                self.assertTrue(paused.wait(5), "The submission never reached matching")
                writing = pool.submit(update_authorization)
                self.assertTrue(writer_ready.wait(5), "The authorization writer did not connect")
                self.assertNotEqual(pids["submission"], pids["writer"])
                deadline = monotonic() + 5
                observed = None
                while monotonic() < deadline:
                    with connections["default"].cursor() as cursor:
                        cursor.execute(
                            "SELECT %s = ANY(pg_blocking_pids(pid)), wait_event_type "
                            "FROM pg_stat_activity WHERE pid = %s",
                            [pids["submission"], pids["writer"]],
                        )
                        observed = cursor.fetchone()
                    if observed == (True, "Lock"):
                        break
                    if writing.done():
                        self.fail(f"Authorization changed before the submission committed: {writing.result()}")
                    sleep(0.01)
                self.assertEqual(observed, (True, "Lock"))
            finally:
                release.set()
            self.assertEqual(submitting.result(timeout=10), 201)
            writing.result(timeout=10)
        denied = self.message(self.body(submission_id=str(uuid4())))
        self.assertIn(denied.status_code, (400, 403, 404), denied.content)

    def test_wallet_verification_change_waits_then_prevents_a_fresh_submission(self):
        self.assert_authorization_change_waits_for_submission(
            lambda: Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="PENDING")
        )

    def test_account_reassignment_waits_then_prevents_a_fresh_submission(self):
        with use_operator():
            successor = a_profile("matching-successor")
        self.assert_authorization_change_waits_for_submission(
            lambda: UserAccount.objects.filter(pk=self.tenant.account.pk).update(user_profile=successor)
        )
