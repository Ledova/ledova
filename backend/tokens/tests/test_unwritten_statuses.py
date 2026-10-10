from django.db import IntegrityError
from django.test import TestCase

from shared.db import atomic
from shared.tests.tenants import make_tenant
from tokens.models import MintRequestStatus, TransferOrder, TransferOrderStatus


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
