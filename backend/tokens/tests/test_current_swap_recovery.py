from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from eth_account.messages import encode_typed_data
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction, TransactionStatus
from blockchain.services.transaction import check_pending_transactions
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY, admitted_signer
from feature_flags.models import FeatureFlag
from shared.db import acting_for, use_operator
from shared.tests.company_eligibility import accept_company_eligibility
from tokens.models import SwapOrderStatus, TransferOrder
from tokens.services import atomic_swap_service, swap_execution
from tokens.tasks.swap_reconciler import resolve_executing_swaps
from tokens.tests.swap_execution_fixtures import ExecutionNode, make_execution
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER, make_swap
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class CurrentSwapSigningTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})

    def test_a_current_swap_still_returns_its_original_context_and_accepts_a_signature(self):
        with use_operator():
            current = make_swap("legacy-hold-current")
            user = current.sell_order.owner_account.user_profile.user
            Wallet.objects.filter(pk=current.seller_wallet_id).update(
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
            )
            typed = atomic_swap_service.get_typed_data(current)
            signature = "0x" + SELLER.sign_message(encode_typed_data(full_message=typed)).signature.hex()
        accept_company_eligibility(
            SimpleNamespace(
                user=user,
                profile=current.sell_order.owner_account.user_profile,
                account=current.sell_order.owner_account,
                company=current.share_token.company,
            )
        )
        identity = {
            "swap_uuid": str(current.pk),
            "owner_account_uuid": str(current.sell_order.owner_account_id),
            "wallet_uuid": str(current.seller_wallet_id),
            "settlement_digest": current.settlement_digest,
        }
        url = f"/api/v1/trading/orders/{current.sell_order_id}/swap/"
        self.client.force_authenticate(user)
        with patch("tokens.services.atomic_swap_service.get_base_chain_client") as provider:
            read = self.client.get(url, identity)
            self.assertEqual(read.status_code, 200, read.content)
            self.assertEqual(read.json()["settlementDigest"], current.settlement_digest)
            signed = self.client.post(
                url + "sign/", {**identity, "signature": signature, "signer_address": SELLER.address}, format="json"
            )
        self.assertEqual(signed.status_code, 200, signed.content)
        provider.assert_not_called()
        with use_operator():
            current.refresh_from_db()
            self.assertEqual(current.seller_signature, signature)
            self.assertEqual(current.status, "seller_signed")


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class CurrentSwapRecoveryReservationsTest(TransactionTestCase):
    def setUp(self):
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))

    def test_current_receipt_keeps_financial_reservations_until_settlement(self):
        fixture = make_execution("legacy-current-recovery")
        current = fixture.swap
        for party, signer in (("seller", SELLER), ("buyer", BUYER)):
            with acting_for(getattr(fixture, party).user.pk):
                current = swap_execution.submit_signature(
                    current,
                    fixture.signatures[party],
                    signer.address,
                    user=getattr(fixture, party).user,
                    participant=party,
                )
        transaction = current.transaction
        BlockchainTransaction.objects.filter(pk=transaction.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        admitted_signer()
        node = ExecutionNode(transaction.function_args)
        parent_rows = list(
            TransferOrder.objects.filter(pk__in=[current.sell_order_id, current.buy_order_id])
            .order_by("pk")
            .values("status", "filled_quantity")
        )
        self.assertEqual(check_pending_transactions(node.client), {"checked": 0, "confirmed": 0, "failed": 0})
        node.client.get_transaction_receipt.assert_not_called()
        with patch("tokens.services.swap_execution.get_base_chain_client", return_value=node.client), patch(
            "tokens.services.swap_execution.publish_trading_event"
        ) as event:
            self.assertEqual(resolve_executing_swaps.func(), {"checked": 1, "resolved": 1})
        current.refresh_from_db()
        transaction.refresh_from_db()
        self.assertEqual(current.status, SwapOrderStatus.EXECUTING)
        self.assertEqual(transaction.status, TransactionStatus.CONFIRMED)
        self.assertEqual(current.tx_hash, transaction.outgoing_operation.current_attempt.tx_hash)
        self.assertEqual(
            list(
                TransferOrder.objects.filter(pk__in=[current.sell_order_id, current.buy_order_id])
                .order_by("pk")
                .values("status", "filled_quantity")
            ),
            parent_rows,
        )
        event.assert_not_called()
