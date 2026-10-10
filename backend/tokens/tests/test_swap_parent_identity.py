from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, connections
from django.test import TestCase, override_settings

from shared.db import atomic, current_alias, use_operator
from shared.tests.tenants import make_tenant
from tokens.models import SwapOrder, SwapOrderStatus, TransferOrder, TransferOrderStatus
from tokens.tests.swap_state_fixtures import CONTRACT, make_swap

IS_POSTGRES = settings.DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql"


OUTSIDER_ADDRESS = "0x" + "9c" * 20


@skipUnless(IS_POSTGRES, "Requires the actual PostgreSQL parent guards")
@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapParentStorageTest(TestCase):
    def test_owner_tuple_changes_refuse_including_a_coherent_reassignment(self):
        swap = make_swap("parent-owner")
        other = make_tenant("parent-new-owner", with_swap=False)
        order = swap.sell_order
        before = TransferOrder.objects.filter(pk=order.pk).values().get()
        for changes in (
            {"uuid": uuid4()},
            {"owner_account_id": other.account.pk},
            {"wallet_id": other.wallet.pk},
            {"wallet_address": other.wallet.address},
            {
                "owner_account_id": other.account.pk,
                "wallet_id": other.wallet.pk,
                "wallet_address": other.wallet.address,
            },
        ):
            with self.subTest(fields=sorted(changes)), self.assertRaisesMessage(
                IntegrityError, "An order owner identity cannot change"
            ), atomic():
                TransferOrder.objects.filter(pk=order.pk).update(**changes)
            self.assertEqual(TransferOrder.objects.filter(pk=order.pk).values().get(), before)

    def test_case_spelling_and_existing_economic_status_and_payment_writes_survive(self):
        tenant = make_tenant("parent-allowed", with_swap=False)
        order = tenant.order
        TransferOrder.objects.filter(pk=order.pk).update(wallet_address=order.wallet_address.upper())
        with use_operator():
            order.refresh_from_db()
        self.assertEqual(order.wallet_address, tenant.wallet.address.upper())
        order.quantity = 12
        order.min_quantity = 2
        order.price_per_share = "2.00"
        order.payment_asset = None
        order.save()
        order.cancel()
        with use_operator():
            order.refresh_from_db()
        self.assertEqual((order.quantity, order.min_quantity, order.status), (12, 2, TransferOrderStatus.CANCELLED))
        self.assertIsNone(order.payment_asset_id)
        swap = make_swap("parent-in-place", ready=True)
        SwapOrder.objects.filter(pk=swap.pk).update(error_message="unresolved")
        with use_operator():
            swap.refresh_from_db()
        self.assertEqual((swap.status, swap.error_message), (SwapOrderStatus.READY, "unresolved"))

    def test_referenced_parent_delete_cannot_be_deferred_until_a_replacement_insert(self):
        swap = make_swap("parent-replacement")
        row = TransferOrder.objects.filter(pk=swap.sell_order_id).values().get()
        with self.assertRaises(IntegrityError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL DEFERRED")
                cursor.execute("DELETE FROM tokens_transferorder WHERE uuid = %s", [swap.sell_order_id])
            self.fail("The referenced parent DELETE must fail before a replacement can be inserted")
        self.assertEqual(TransferOrder.objects.filter(pk=swap.sell_order_id).values().get(), row)
        self.assertTrue(SwapOrder.objects.filter(pk=swap.pk).exists())

    def test_an_unreferenced_order_remains_deletable_and_retained_v1_does_not(self):
        tenant = make_tenant("parent-delete", with_swap=False)
        order_id = tenant.order.pk
        tenant.order.delete()
        self.assertFalse(TransferOrder.objects.filter(pk=order_id).exists())
        swap = make_swap("parent-retained")
        with self.assertRaisesMessage(IntegrityError, "cannot be deleted"), atomic():
            swap.sell_order.delete()
        self.assertTrue(TransferOrder.objects.filter(pk=swap.sell_order_id).exists())
        self.assertTrue(SwapOrder.objects.filter(pk=swap.pk).exists())

    def test_only_two_parent_constraints_restrict_deletes_and_no_function_gains_privilege(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT a.attname, c.confdeltype, c.condeferrable, c.condeferred "
                "FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
                "WHERE c.contype = 'f' AND c.conrelid = 'tokens_swaporder'::regclass "
                "AND c.confrelid = 'tokens_transferorder'::regclass ORDER BY a.attname"
            )
            self.assertEqual(
                cursor.fetchall(), [("buy_order_id", "r", False, False), ("sell_order_id", "r", False, False)]
            )
            cursor.execute(
                "SELECT proname, prosecdef FROM pg_proc WHERE proname IN "
                "('tokens_swap_has_current_party', 'tokens_swaporder_seller_wallet_id_is_derived', "
                "'tokens_swaporder_buyer_wallet_id_is_derived') ORDER BY proname"
            )
            functions = cursor.fetchall()
        self.assertEqual(len(functions), 3)
        self.assertTrue(all(not privileged for _name, privileged in functions))
