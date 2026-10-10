from copy import deepcopy
from datetime import timedelta
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.db import IntegrityError
from django.test import TransactionTestCase, override_settings

from shared.db import acting_for, atomic
from tokens.models import SwapOrder, SwapOrderStatus
from tokens.services import swap_execution
from tokens.tests.swap_execution_fixtures import make_execution
from tokens.tests.swap_state_fixtures import (
    BUYER,
    CONTRACT,
    SELLER,
    make_swap,
    persisted_outcome,
    swap_service,
)

IS_POSTGRES = settings.DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql"


@skipUnless(IS_POSTGRES, "Requires the actual PostgreSQL settlement trigger")
@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapSettlementStorageTest(TransactionTestCase):
    def test_identity_updates_and_delete_refuse_while_both_signature_writes_remain_legal(self):
        swap = make_swap("settlement-guard", ready=True)
        before = persisted_outcome(swap)
        changed_context = deepcopy(swap.settlement_context)
        changed_context["typed_data"]["domain"]["verifyingContract"] = "0x" + "79" * 20
        for field, value in (
            ("settlement_protocol_version", 0),
            ("settlement_context", changed_context),
            ("settlement_context", None),
            ("settlement_digest", "0x" + "bb" * 32),
            ("share_amount", swap.share_amount + 1),
            ("payment_amount", swap.payment_amount + 1),
            ("nonce", swap.nonce + 1),
            ("order_hash", "aa" * 32),
            ("expires_at", swap.expires_at + timedelta(seconds=1)),
            ("created_at", swap.created_at + timedelta(seconds=1)),
            ("seller_wallet_id", swap.buyer_wallet_id),
            ("seller_address", BUYER.address),
        ):
            with self.subTest(field=field), self.assertRaises(IntegrityError), atomic():
                SwapOrder.objects.filter(pk=swap.pk).update(**{field: value})
            self.assertEqual(persisted_outcome(swap), before)
        with self.assertRaises(IntegrityError), atomic():
            SwapOrder.objects.filter(pk=swap.pk).delete()
        self.assertEqual(persisted_outcome(swap), before)
        SwapOrder.objects.filter(pk=swap.pk).update(error_message="pending")
        swap.refresh_from_db()
        self.assertEqual(
            (swap.seller_signature, swap.buyer_signature), (before[0]["seller_signature"], before[0]["buyer_signature"])
        )
        self.assertEqual(swap.status, SwapOrderStatus.READY)

    def test_database_refuses_identity_change_during_real_signature_validation(self):
        from eth_account.messages import encode_typed_data

        fixture = make_execution("settlement-sign-guard")
        swap = fixture.swap
        service = swap_service(self)
        signature = SELLER.sign_message(
            encode_typed_data(full_message=service.get_typed_data(swap))
        ).signature.to_0x_hex()
        verify = service.verify_signature

        def change(*args):
            self.assertTrue(verify(*args))
            SwapOrder.objects.filter(pk=swap.pk).update(share_amount=swap.share_amount + 1)
            return True

        with acting_for(fixture.seller.user.pk):
            with patch.object(service, "verify_signature", side_effect=change), self.assertRaises(IntegrityError):
                swap_execution.submit_signature(
                    swap, signature, SELLER.address, user=fixture.seller.user, participant="seller"
                )
        swap.refresh_from_db()
        self.assertFalse(swap.seller_signature)
        with acting_for(fixture.seller.user.pk):
            with patch("tokens.services.swap_execution.publish_trading_event"):
                signed = swap_execution.submit_signature(
                    swap, signature, SELLER.address, user=fixture.seller.user, participant="seller"
                )
        self.assertEqual(signed.seller_signature, signature)
