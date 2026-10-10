from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from django.db import connections
from django.test import TransactionTestCase

from portfolios.models import Portfolio
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from users.models import UserAccount
from users.services import identity
from users.tests.test_identity_apply_race import (
    PUSH_TASK,
    a_profile_awaiting_its_result,
    an_approval,
)


class IdentityLockOrderTest(RealRowContention, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.profile = a_profile_awaiting_its_result("identity-lock-order@example.test")
            self.account = UserAccount.objects.get(user_profile=self.profile)
        self.enterContext(patch(PUSH_TASK))

    def test_normalized_approval_waits_on_the_actual_account_before_the_profile(self):
        with patch.object(identity, "_trigger_risk_assessment") as assessment:
            result = self.while_row_is_held(
                lambda: identity.update_status_from_normalized(self.profile, an_approval()),
                self.account,
                free=(self.profile,),
            )
        self.assertTrue(result)
        with use_operator():
            self.account.refresh_from_db()
            self.profile.refresh_from_db()
        self.assertEqual(self.account.account_status, "active")
        self.assertTrue(self.profile.is_id_verified)
        self.assertEqual(assessment.call_args.args[0].pk, self.account.pk)

    def test_normalized_approval_holds_the_actual_account_while_waiting_on_the_profile(self):
        def create_deferred_reference():
            Portfolio.objects.create(user_account=self.account, name="Actual provider account lock FK")

        with patch.object(identity, "_trigger_risk_assessment"):
            self.assertTrue(
                self.while_row_is_held(
                    lambda: identity.update_status_from_normalized(self.profile, an_approval()),
                    self.profile,
                    held=(self.account,),
                    after_wait=create_deferred_reference,
                )
            )
        with use_operator():
            self.assertTrue(
                Portfolio.objects.filter(user_account=self.account, name="Actual provider account lock FK").exists()
            )

    def test_account_no_key_update_allows_a_real_deferred_foreign_key_commit(self):
        inspection = connections["default"].copy()
        inserted, committed, pid = Event(), Event(), []

        def insert():
            connections.close_all()
            try:
                with use_operator():
                    with atomic():
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SET LOCAL lock_timeout = '5s'")
                            cursor.execute("SELECT pg_backend_pid()")
                            pid.append(cursor.fetchone()[0])
                        portfolio = Portfolio.objects.create(user_account=self.account, name="Committed FK control")
                        inserted.set()
                    committed.set()
                    return portfolio.pk
            finally:
                connections.close_all()

        try:
            with inspection.cursor() as cursor:
                cursor.execute(
                    "SELECT condeferrable, condeferred FROM pg_constraint "
                    "WHERE conrelid = 'portfolios'::regclass AND confrelid = 'customer_accounts_account'::regclass"
                )
                self.assertEqual(cursor.fetchall(), [(True, True)])
            with ThreadPoolExecutor(max_workers=1) as pool:
                with use_migrate(), atomic():
                    UserAccount.objects.select_for_update(no_key=True).get(pk=self.account.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    future = pool.submit(insert)
                    self.assertTrue(inserted.wait(5))
                    portfolio_id = future.result(timeout=5)
                    self.assertTrue(committed.is_set())
                    self.assertNotEqual(blocker, pid[0])
                    with inspection.cursor() as cursor:
                        cursor.execute("SELECT user_account_id FROM portfolios WHERE uuid = %s", [portfolio_id])
                        self.assertEqual(cursor.fetchone()[0], self.account.pk)
        finally:
            inspection.close()

    def test_account_update_blocks_that_same_foreign_key_at_real_commit(self):
        inserted, pid = Event(), []
        inspection = connections["default"].copy()

        def insert():
            connections.close_all()
            try:
                with use_operator(), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        pid.append(cursor.fetchone()[0])
                    Portfolio.objects.create(user_account=self.account, name="Deferred stronger lock control")
                    inserted.set()
                return "committed"
            finally:
                connections.close_all()

        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                with use_migrate(), atomic():
                    UserAccount.objects.select_for_update().get(pk=self.account.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    future = pool.submit(insert)
                    self.assertTrue(inserted.wait(5))
                    self.wait_for_pid(inspection, pid[0], blocker, query="COMMIT")
                    self.assertFalse(future.done())
                self.assertEqual(future.result(timeout=10), "committed")
        finally:
            inspection.close()
