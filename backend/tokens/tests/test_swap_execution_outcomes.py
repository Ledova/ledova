from unittest.mock import patch

from django.conf import settings
from django.db import transaction
from django.test import TransactionTestCase, override_settings

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    TransactionStatus,
)
from blockchain.tests.outgoing_fixtures import admitted_signer
from integrations.base_chain.exceptions import GasEstimationError
from tokens.exceptions import SwapNotReadyException
from tokens.models import SwapOrderStatus
from tokens.services import swap_execution
from tokens.tests.swap_execution_fixtures import ExecutionNode, make_execution
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER

RPC_URL = "https://synthetic.invalid/private-provider-token"


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
class SwapExecutionRecordsItsOutcomeTest(TransactionTestCase):
    def setUp(self):
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        self.fixture = make_execution("outcome")
        admitted_signer(chain_id=settings.BLOCKCHAIN_CHAIN_ID)
        for participant, key in (("seller", SELLER), ("buyer", BUYER)):
            self.swap = swap_execution.submit_signature(
                self.fixture.swap,
                self.fixture.signatures[participant],
                key.address,
                user=getattr(self.fixture, participant).user,
                participant=participant,
            )
        self.record = self.swap.transaction
        self.node = ExecutionNode(self.record.function_args)
        self.before = self.parent_state()

    def parent_state(self):
        return [
            (order.status, order.filled_quantity)
            for order in type(self.fixture.orders[0])
            .objects.filter(pk__in=[order.pk for order in self.fixture.orders])
            .order_by("pk")
        ]

    def recover(self):
        result = swap_execution.recover(self.record.pk, client=self.node.client)
        self.swap.refresh_from_db()
        self.record.refresh_from_db()
        return result

    def assert_held(self):
        self.assertEqual(self.swap.status, SwapOrderStatus.EXECUTING)
        self.assertIsNone(self.swap.completed_at)
        self.assertEqual(self.parent_state(), self.before)

    def test_lost_acknowledgement_keeps_the_durable_original_hash_and_bytes(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.assertEqual(self.recover(), "signed")
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.record.tx_hash, attempt.tx_hash)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])
        self.assert_held()

    def test_preparation_refusal_releases_only_an_unsigned_intent_once(self):
        self.node.client.estimate_gas.side_effect = GasEstimationError("execution reverted")
        self.assertEqual(self.recover(), "failed")
        self.assertEqual((self.record.status, self.record.tx_hash), (TransactionStatus.FAILED, None))
        self.assertEqual(self.swap.status, SwapOrderStatus.FAILED)
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertTrue(all(filled == 0 for _status, filled in self.parent_state()))
        after = self.parent_state()
        self.assertEqual(self.recover(), "failed")
        self.assertEqual(self.parent_state(), after)
        self.node.client.send_raw_transaction.assert_not_called()

    def test_missing_receipt_does_not_guess_the_financial_outcome(self):
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        self.assertEqual(self.record.status, TransactionStatus.SUBMITTED)
        self.assert_held()

    def test_a_confirmed_receipt_is_recorded_with_financial_holds_unchanged(self):
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(self.record.status, TransactionStatus.CONFIRMED)
        self.assertEqual((self.record.block_number, self.record.gas_used), (12, 21000))
        self.assert_held()

    def test_a_revert_is_distinguished_from_unknown_without_releasing_holds(self):
        self.node.status = 0
        self.assertEqual(self.recover(), "reverted")
        self.assertEqual(self.record.status, TransactionStatus.REVERTED)
        self.assertEqual(OutgoingOperation.objects.get().status, "reverted")
        self.assert_held()

    def test_completed_receipt_projection_is_idempotent_without_more_rpc(self):
        self.assertEqual(self.recover(), "confirmed")
        before = BlockchainTransaction.objects.values().get(pk=self.record.pk)
        self.node.client.reset_mock()
        self.assertEqual(self.recover(), "confirmed")
        after = BlockchainTransaction.objects.values().get(pk=self.record.pk)
        before.pop("updated_at")
        after.pop("updated_at")
        self.assertEqual(after, before)
        self.assertEqual(self.node.client.mock_calls, [])
        self.assert_held()

    def test_private_node_details_do_not_reach_the_parties_or_journal(self):
        self.node.client.estimate_gas.side_effect = ConnectionError(RPC_URL)
        self.assertEqual(self.recover(), "failed")
        for message in (self.swap.error_message, self.record.error_message):
            self.assertNotIn("private-provider-token", message)
            self.assertNotIn("synthetic.invalid", message)
        self.assertEqual(self.swap.error_message, "Swap execution could not be prepared")

    def test_a_recognised_revert_reason_remains_actionable_without_provider_details(self):
        self.node.client.estimate_gas.side_effect = GasEstimationError("execution reverted: 0xbf3f9389 at " + RPC_URL)
        self.assertEqual(self.recover(), "failed")
        self.assertEqual(self.swap.error_message, "Sender is not whitelisted for transfers")
        self.assertNotIn("private-provider-token", self.record.error_message)
        self.node.client.send_raw_transaction.assert_not_called()

    def test_an_atomic_caller_is_refused_before_opening_or_sending(self):
        with self.assertRaises(SwapNotReadyException), transaction.atomic():
            self.recover()
        self.assertFalse(OutgoingOperation.objects.exists())
        self.assertEqual(self.node.client.mock_calls, [])
        self.assert_held()
