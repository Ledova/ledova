from unittest.mock import patch

from django.test import TransactionTestCase, override_settings
from eth_account.messages import encode_typed_data

from tokens.exceptions import (
    SwapNotReadyException,
    SwapSignatureException,
)
from tokens.models import SwapOrder, SwapOrderStatus
from tokens.tests.swap_state_fixtures import (
    BUYER,
    CONTRACT,
    SELLER,
    make_swap,
    persisted_outcome,
    sign_swap,
    swap_service,
)


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
@patch("tokens.services.swap_execution.publish_trading_event")
class SwapSignaturesUseTheFreshStateTest(TransactionTestCase):

    def setUp(self):
        self.enterContext(self.settings(BLOCKCHAIN_OPERATOR_KEY=""))
        self.swap = make_swap("signature-fence")
        self.service = swap_service(self)
        signable = encode_typed_data(full_message=self.service.get_typed_data(self.swap))
        self.seller_signature = SELLER.sign_message(signable).signature.hex()
        self.buyer_signature = BUYER.sign_message(signable).signature.hex()

    def test_two_old_unsigned_instances_preserve_both_signatures_and_become_ready(self, _publish):
        stale = SwapOrder.objects.get(pk=self.swap.pk)
        sign_swap(self.swap, self.seller_signature, SELLER.address)
        ready = sign_swap(stale, self.buyer_signature, BUYER.address)
        self.assertEqual(ready.status, SwapOrderStatus.READY)
        self.assertEqual((ready.seller_signature, ready.buyer_signature), (self.seller_signature, self.buyer_signature))

    def test_a_missing_signature_cannot_reopen_a_failed_swap(self, _publish):
        self.swap.mark_failed("declined before signing")
        before = persisted_outcome(self.swap)
        with self.assertRaises(SwapNotReadyException):
            sign_swap(self.swap, self.seller_signature, SELLER.address)
        self.assertEqual(persisted_outcome(self.swap), before)

    def test_an_exact_repeat_preserves_the_failed_state_and_timestamps(self, _publish):
        signed = sign_swap(self.swap, self.seller_signature, SELLER.address)
        signed.mark_failed("declined before the other signature")
        before = persisted_outcome(self.swap)
        sign_swap(self.swap, self.seller_signature, SELLER.address)
        self.assertEqual(persisted_outcome(self.swap), before)

    def test_a_stale_in_memory_snapshot_during_verification_is_not_signed(self, _publish):
        verify = self.service.verify_signature

        def change(*args):
            valid = verify(*args)
            args[0].share_amount += 1
            return valid

        self.enterContext(patch.object(self.service, "verify_signature", change))
        with self.assertRaises(SwapSignatureException):
            sign_swap(self.swap, self.seller_signature, SELLER.address)
        self.swap.refresh_from_db()
        self.assertEqual(self.swap.seller_signature, "")
