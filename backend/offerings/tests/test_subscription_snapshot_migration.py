from contextlib import contextmanager

from django.conf import settings
from django.db import DatabaseError, connection, transaction
from django.test import TransactionTestCase

from companies.models import Company
from offerings.models import Offering, Subscription
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken, ShareTokenStatus

BEFORE = [("offerings", "0007_subscription_step_times")]
AFTER = [("offerings", "0008_subscription_snapshots")]


class SubscriptionSnapshotMigrationTest(TransactionTestCase):
    def tearDown(self):
        restore_every_migration()
        super().tearDown()

    def test_existing_hidden_applications_receive_the_names_and_currency_and_reverse_restores_the_old_trigger(self):
        one = make_tenant("snapshot-migration-one")
        two = make_tenant("snapshot-migration-two")
        Company.objects.filter(pk=one.company.pk).update(trading_name="Synthetic historical trading name")
        Offering.objects.filter(pk=one.offering.pk).update(price_currency="USD")
        ShareToken.objects.filter(pk=one.offering.token_id).update(status=ShareTokenStatus.PAUSED)
        Company.objects.filter(pk=one.company.pk).update(is_open_to_investors=False, status="suspended")
        Company.objects.filter(pk=two.company.pk).update(is_open_to_investors=False)
        Subscription.objects.filter(pk=one.subscription.pk).update(user_account=two.account, wallet=two.wallet)
        before = migrate_to(BEFORE)
        historical = before.get_model("offerings", "Subscription")
        self.assertEqual(historical.objects.count(), 2)
        self.assertNotIn("company_name", {field.name for field in historical._meta.fields})
        with self.as_app(two.user), self.assertRaisesMessage(DatabaseError, "cannot be derived"), transaction.atomic():
            historical.objects.filter(pk=one.subscription.pk).update(payment_notes="Blocked before upgrade")

        after = migrate_to(AFTER)
        historical = after.get_model("offerings", "Subscription")
        first = historical.objects.get(pk=one.subscription.pk)
        second = historical.objects.get(pk=two.subscription.pk)
        self.assertEqual(
            (first.company_name, first.token_name, first.token_symbol, first.currency),
            ("Synthetic historical trading name", one.offering.token.name, one.offering.token.symbol, "USD"),
        )
        self.assertEqual(second.company_name, two.company.name)
        self.assertEqual(second.currency, "AUD")
        self.assertIn("OLD.company_id IS NOT NULL", self.trigger_body())
        with self.as_app(two.user):
            self.assertEqual(historical.objects.filter(pk=first.pk).update(payment_notes="Retained after upgrade"), 1)
        self.assertEqual(historical.objects.get(pk=first.pk).payment_notes, "Retained after upgrade")

        reversed_apps = migrate_to(BEFORE)
        self.assertEqual(reversed_apps.get_model("offerings", "Subscription").objects.count(), 2)
        self.assertNotIn("OLD.company_id IS NOT NULL", self.trigger_body())
        historical = reversed_apps.get_model("offerings", "Subscription")
        with self.as_app(two.user), self.assertRaisesMessage(DatabaseError, "cannot be derived"), transaction.atomic():
            historical.objects.filter(pk=first.pk).update(payment_notes="Blocked after reversal")
        migrate_to(AFTER)
        self.assertIn("OLD.company_id IS NOT NULL", self.trigger_body())
        restore_every_migration()
        self.assertEqual(Subscription.objects.get(pk=one.subscription.pk).company_name, first.company_name)
        self.assertIn("OLD.company_id IS NOT NULL", self.trigger_body())

    @contextmanager
    def as_app(self, user):
        with connection.cursor() as cursor:
            cursor.execute(f"SET ROLE {settings.RLS_ROLES['app']}")
            cursor.execute("SELECT set_config('app.user_id', %s, false)", [str(user.pk)])
        try:
            yield
        finally:
            with connection.cursor() as cursor:
                cursor.execute("RESET ROLE")
                cursor.execute("RESET app.user_id")

    def trigger_body(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT prosrc FROM pg_proc WHERE proname = 'offerings_subscription_company_is_derived'")
            return cursor.fetchone()[0]
