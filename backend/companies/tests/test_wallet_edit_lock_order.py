import tempfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import timedelta
from threading import Event
from time import monotonic, sleep

from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from companies.services.administration import company_operation
from companies.services.editing import update_company
from companies.tests import test_company_administration as fixtures
from companies.tests.test_authority_requests import STORAGES
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserAccount, UserProfile
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet


class CompanyWalletLockOrderTest(StubUploadDependencies, RealRowContention, APITransactionTestCase):
    account = fixtures.CompanyAdministrationTest.account
    register = fixtures.CompanyAdministrationTest.register
    admit = fixtures.CompanyAdministrationTest.admit
    operator_as = fixtures.CompanyAdministrationTest.operator_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        self.owner, self.profile = self.account("wallet-lock-owner")
        self.other, self.other_profile = self.account("wallet-lock-other")
        self.company = self.register(self.owner, "12345678")
        expiry = (
            {"requested_expires_at": timezone.now() + timedelta(seconds=2)} if "expiry" in self._testMethodName else {}
        )
        self.appointment = self.admit(**expiry)
        with use_migrate():
            self.owner_account = UserAccount.objects.create(account_number="WALLET-LOCK", user_profile=self.profile)
            self.wallet = Wallet.objects.create(
                user_account=self.owner_account,
                address="0x" + "12" * 20,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
            )

    def edit(self, *, raw=False):
        with self.operator_as(self.owner):
            if raw:
                with company_operation(self.owner, self.company.pk, "edit"), atomic():
                    Company.objects.filter(pk=self.company.pk).update(operator_wallet=self.wallet)
            else:
                update_company(self.company, {"operator_wallet": self.wallet}, actor=self.owner)
        return "written"

    def check_prefix(self, row, free, held, *, raw):
        result = self.while_row_is_held(
            lambda: self.edit(raw=raw),
            row,
            free=free,
            held=held,
            wait_query=Company._meta.db_table if raw else None,
        )
        self.assertEqual(result, "written")
        with use_operator():
            current = Company.objects.get(pk=self.company.pk)
        self.assertEqual(current.operator_wallet_id, self.wallet.pk)
        self.assertEqual(
            (current.status, current.lifecycle_revision), (self.company.status, self.company.lifecycle_revision)
        )

    def test_service_waits_on_wallet_before_account_actor_and_profile(self):
        self.check_prefix(self.wallet, (self.owner_account, self.owner, self.profile), (self.company,), raw=False)

    def test_service_waits_on_account_before_actor_and_profile(self):
        self.check_prefix(self.owner_account, (self.owner, self.profile), (self.company, self.wallet), raw=False)

    def test_service_waits_on_actor_before_the_exact_wallet_profile(self):
        self.check_prefix(self.owner, (self.profile,), (self.company, self.wallet, self.owner_account), raw=False)

    def test_sql_guard_waits_on_wallet_before_account_actor_and_profile(self):
        self.check_prefix(self.wallet, (self.owner_account, self.owner, self.profile), (self.company,), raw=True)

    def test_sql_guard_waits_on_account_before_actor_and_profile(self):
        self.check_prefix(self.owner_account, (self.owner, self.profile), (self.company, self.wallet), raw=True)

    def test_sql_guard_waits_on_actor_before_the_exact_wallet_profile(self):
        self.check_prefix(self.owner, (self.profile,), (self.company, self.wallet, self.owner_account), raw=True)

    def assert_refused_after_owner_change(self, *, raw):
        def edit_or_refuse():
            try:
                return self.edit(raw=raw)
            except (NotFound, ValidationError):
                return "refused"
            except DatabaseError as error:
                self.assertEqual(error.__cause__.sqlstate, "23514")
                return "refused"

        def change_owner():
            UserProfile.objects.filter(pk=self.profile.pk).update(user=self.other)

        self.assertEqual(
            self.while_row_is_held(
                edit_or_refuse,
                self.owner,
                free=(self.profile,),
                after_wait=change_owner,
                wait_query=Company._meta.db_table if raw else None,
            ),
            "refused",
        )
        with use_operator():
            self.assertIsNone(Company.objects.get(pk=self.company.pk).operator_wallet_id)

    def test_service_rechecks_actual_profile_owner_after_actor_wait(self):
        with use_migrate():
            UserProfile.objects.filter(pk=self.other_profile.pk).delete()
        self.assert_refused_after_owner_change(raw=False)

    def test_sql_guard_rechecks_actual_profile_owner_after_actor_wait(self):
        with use_migrate():
            UserProfile.objects.filter(pk=self.other_profile.pk).delete()
        self.assert_refused_after_owner_change(raw=True)

    def assert_refused_after_account_profile_change(self, *, raw):
        def edit_or_refuse():
            try:
                return self.edit(raw=raw)
            except (NotFound, ValidationError):
                return "refused"
            except DatabaseError as error:
                self.assertEqual(error.__cause__.sqlstate, "23514")
                return "refused"

        def change_profile():
            UserAccount.objects.filter(pk=self.owner_account.pk).update(user_profile=self.other_profile)

        self.assertEqual(
            self.while_row_is_held(
                edit_or_refuse,
                self.owner_account,
                free=(self.owner, self.profile, self.other),
                after_wait=change_profile,
                wait_query=Company._meta.db_table if raw else None,
            ),
            "refused",
        )
        with use_operator():
            self.assertIsNone(Company.objects.get(pk=self.company.pk).operator_wallet_id)

    def test_service_rechecks_the_actual_account_profile_after_account_wait(self):
        self.assert_refused_after_account_profile_change(raw=False)

    def test_sql_guard_rechecks_the_actual_account_profile_after_account_wait(self):
        self.assert_refused_after_account_profile_change(raw=True)

    def assert_changed_owner_refuses_without_locking_the_foreign_profile(self, *, raw):
        account_held, release_account, candidate_started = Event(), Event(), Event()
        account_pid, candidate_pid = [], []
        inspection = connections["default"].copy()

        def rebind_account():
            connections.close_all()
            try:
                with use_migrate(), atomic():
                    UserAccount.objects.select_for_update().get(pk=self.owner_account.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        account_pid.append(cursor.fetchone()[0])
                    account_held.set()
                    if not release_account.wait(10):
                        raise AssertionError("The account rebind barrier was not released")
                    UserAccount.objects.filter(pk=self.owner_account.pk).update(user_profile=self.other_profile)
                return "rebound-and-committed"
            finally:
                connections.close_all()

        def edit_or_refuse():
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SET statement_timeout = '15s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        candidate_pid.append(cursor.fetchone()[0])
                    candidate_started.set()
                    try:
                        return self.edit(raw=raw)
                    except (NotFound, ValidationError):
                        return "refused"
                    except DatabaseError as error:
                        self.assertEqual(error.__cause__.sqlstate, "23514")
                        return "refused"
            finally:
                connections.close_all()

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                with use_migrate(), atomic():
                    UserProfile.objects.select_for_update(no_key=True).get(pk=self.other_profile.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        foreign_pid = cursor.fetchone()[0]
                    changing = pool.submit(rebind_account)
                    self.assertTrue(account_held.wait(5))
                    editing = pool.submit(edit_or_refuse)
                    self.assertTrue(candidate_started.wait(5))
                    self.assertEqual(len({foreign_pid, account_pid[0], candidate_pid[0]}), 3)
                    self.wait_for_pid(
                        inspection,
                        candidate_pid[0],
                        account_pid[0],
                        row=self.owner_account,
                        query=Company._meta.db_table if raw else None,
                    )
                    release_account.set()
                    self.assertEqual(changing.result(timeout=5), "rebound-and-committed")
                    try:
                        self.assertEqual(editing.result(timeout=3), "refused")
                    except TimeoutError:
                        self.wait_for_pid(inspection, candidate_pid[0], foreign_pid, row=self.other_profile)
                        self.fail("The changed-owner refusal waited on the newly named foreign profile")
            with use_operator():
                self.assertEqual(
                    UserAccount.objects.get(pk=self.owner_account.pk).user_profile_id, self.other_profile.pk
                )
                self.assertIsNone(Company.objects.get(pk=self.company.pk).operator_wallet_id)
        finally:
            release_account.set()
            inspection.close()

    def test_service_refuses_changed_account_owner_without_waiting_on_the_foreign_profile(self):
        self.assert_changed_owner_refuses_without_locking_the_foreign_profile(raw=False)

    def test_sql_guard_refuses_changed_account_owner_without_waiting_on_the_foreign_profile(self):
        self.assert_changed_owner_refuses_without_locking_the_foreign_profile(raw=True)

    def assert_refused_after_expiry(self, *, raw):
        def edit_or_refuse():
            try:
                return self.edit(raw=raw)
            except NotFound:
                return "refused"
            except DatabaseError as error:
                self.assertEqual(error.__cause__.sqlstate, "23514")
                return "refused"

        def expire():
            deadline = monotonic() + 5
            while monotonic() < deadline:
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT clock_timestamp() >= %s", [self.appointment.expires_at])
                    if cursor.fetchone()[0]:
                        return
                sleep(0.01)
            self.fail("The real appointment expiry did not pass while the wallet lock was held")

        self.assertEqual(
            self.while_row_is_held(
                edit_or_refuse,
                self.wallet,
                after_wait=expire,
                wait_query=Company._meta.db_table if raw else None,
            ),
            "refused",
        )
        with use_operator():
            self.assertIsNone(Company.objects.get(pk=self.company.pk).operator_wallet_id)

    def test_service_rechecks_appointment_expiry_after_wallet_wait(self):
        self.assert_refused_after_expiry(raw=False)

    def test_sql_guard_rechecks_appointment_expiry_after_wallet_wait(self):
        self.assert_refused_after_expiry(raw=True)
