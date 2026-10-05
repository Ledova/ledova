from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase, TransactionTestCase

from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import MintRequestStatus, TransferOrder, TransferOrderStatus
from tokens.tests.mint_request_fixtures import mint_request

BEFORE = [("tokens", "0080_company_pack")]
AFTER = [("tokens", "0081_held_orders_and_retired_statuses")]
ADMISSION_FIELDS = (
    "eligibility_decision_id",
    "creation_submission_id",
    "last_modification_action_id",
    "last_modification_eligibility_decision_id",
)


class UnwrittenStatusesTest(TestCase):
    def test_an_order_has_only_the_statuses_the_market_writes(self):
        self.assertEqual(
            set(TransferOrderStatus.values),
            {"open", "partially_filled", "held", "matched", "pending_signature", "completed", "cancelled"},
        )

    def test_the_database_refuses_an_order_status_nothing_writes(self):
        order = make_tenant("unwritten").order
        for status in ("expired", "failed", "executing"):
            with self.subTest(status=status), self.assertRaises(IntegrityError), atomic():
                TransferOrder.objects.filter(pk=order.pk).update(status=status)

    def test_a_mint_request_has_only_the_statuses_minting_writes(self):
        self.assertEqual(set(MintRequestStatus.values), {"pending", "executing", "executed", "failed", "rejected"})


class RetiredStatusMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)
        self.order = make_tenant("retired").order
        self.assertEqual(
            TransferOrder.objects.filter(pk=self.order.pk).values_list(*ADMISSION_FIELDS).get(), (None,) * 4
        )
        actor = get_user_model().objects.create_superuser(email="retired@example.test", password="synthetic")
        self.deposit = mint_request(actor)

    def test_rows_holding_a_retired_status_stop_the_migration_and_are_left_as_they_were(self):
        before = migrate_to(BEFORE)
        orders = before.get_model("tokens", "TransferOrder").objects
        deposits = before.get_model("tokens", "MintRequest").objects
        orders.filter(pk=self.order.pk).update(status="expired")
        deposits.filter(pk=self.deposit.pk).update(status="approved")

        with self.assertRaisesMessage(RuntimeError, f"TransferOrder expired: {self.order.pk}") as refused:
            migrate_to(AFTER)

        self.assertIn(f"MintRequest approved: {self.deposit.pk}", str(refused.exception))
        self.assertIn("No rows have been changed", str(refused.exception))
        self.assertEqual(orders.get(pk=self.order.pk).status, "expired")
        self.assertEqual(deposits.get(pk=self.deposit.pk).status, "approved")
        orders.filter(pk=self.order.pk).update(status="open")
        deposits.filter(pk=self.deposit.pk).update(status="pending")
        after = migrate_to(AFTER)
        self.assertEqual(
            after.get_model("tokens", "TransferOrder").objects.get(pk=self.order.pk).status, TransferOrderStatus.OPEN
        )
        restore_every_migration()
        self.assertEqual(
            TransferOrder.objects.filter(pk=self.order.pk).values_list(*ADMISSION_FIELDS).get(), (None,) * 4
        )

    def test_a_held_order_stops_the_reversal_and_stays_held(self):
        TransferOrder.objects.filter(pk=self.order.pk).update(status=TransferOrderStatus.HELD)

        with self.assertRaisesMessage(RuntimeError, f"First 20 identifiers: {self.order.pk}"):
            migrate_to(BEFORE)

        after = migrate_to(AFTER)
        orders = after.get_model("tokens", "TransferOrder").objects
        self.assertEqual(orders.get(pk=self.order.pk).status, TransferOrderStatus.HELD)
        orders.filter(pk=self.order.pk).update(status=TransferOrderStatus.CANCELLED)
        before = migrate_to(BEFORE)
        with self.assertRaises(IntegrityError), atomic():
            before.get_model("tokens", "TransferOrder").objects.filter(pk=self.order.pk).update(status="held")
        restore_every_migration()
        self.assertEqual(
            TransferOrder.objects.filter(pk=self.order.pk).values_list(*ADMISSION_FIELDS).get(), (None,) * 4
        )
