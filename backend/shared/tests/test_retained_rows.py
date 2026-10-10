from unittest import skipUnless

from django.db import DatabaseError, connections
from django.test import TransactionTestCase

from shared.db import MIGRATE_ALIAS, atomic, use_migrate
from shared.tests.retained_rows import retained_rows
from shared.tests.tenants import make_tenant
from tokens.models import RequestStatus, ShareIssuanceRequest
from tokens.tests.retained_guards import REQUEST_GUARDS


@skipUnless(connections[MIGRATE_ALIAS].vendor == "postgresql", "Retained SQL history requires PostgreSQL")
class RetainedRowsFixtureTest(TransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("retained-fixture", with_swap=False)

    def request(self):
        return ShareIssuanceRequest.objects.create(
            token=self.tenant.deployed_token,
            recipient_address=self.tenant.wallet.address,
            amount=5,
            reason="Synthetic retained history",
        )

    def enable_states(self):
        with connections[MIGRATE_ALIAS].cursor() as cursor:
            cursor.execute(
                "SELECT tgname,tgenabled FROM pg_trigger "
                "WHERE tgrelid='tokens_shareissuancerequest'::regclass AND NOT tgisinternal"
            )
            return dict(cursor.fetchall())

    def assert_current_approval_refused(self):
        request = self.request()
        with self.assertRaisesMessage(DatabaseError, "requires its retained company decision"), atomic():
            request.approve(self.tenant.user)
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.SUBMITTED)

    def test_a_retained_approval_does_not_open_a_new_approval_path(self):
        with use_migrate():
            self.assert_current_approval_refused()
            before = self.enable_states()
            request = self.request()
            with retained_rows(*REQUEST_GUARDS):
                request.approve(self.tenant.user)
            request.refresh_from_db()
            self.assertEqual(request.status, RequestStatus.APPROVED)
            self.assertEqual(self.enable_states(), before)
            self.assert_current_approval_refused()

    def test_a_fixture_failure_restores_the_live_approval_guards(self):
        with use_migrate():
            before = self.enable_states()
            with self.assertRaisesRegex(RuntimeError, "synthetic fixture failure"):
                with retained_rows(*REQUEST_GUARDS):
                    raise RuntimeError("synthetic fixture failure")
            self.assertEqual(self.enable_states(), before)
            self.assert_current_approval_refused()

    def test_an_unknown_guard_is_refused_before_any_known_guard_is_disabled(self):
        with use_migrate():
            before = self.enable_states()
            with self.assertRaisesMessage(AssertionError, "Every retained fixture trigger must exist"):
                with retained_rows(*REQUEST_GUARDS, ("tokens_shareissuancerequest", "absent_guard")):
                    self.fail("An unknown guard must never admit fixture writes")
            self.assertEqual(self.enable_states(), before)
            self.assert_current_approval_refused()

    def test_an_open_transaction_cannot_take_over_trigger_restoration(self):
        with use_migrate(), atomic():
            with self.assertRaisesMessage(AssertionError, "autocommit synthetic test database"):
                with retained_rows(*REQUEST_GUARDS):
                    self.fail("Trigger fixture setup must reject an enclosing transaction")
