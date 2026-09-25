from types import SimpleNamespace
from unittest.mock import call

from django.db import connections
from django.test import TransactionTestCase

from blockchain.models import (
    OutgoingOperation,
    OutgoingStatus,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services.outgoing import reconcile_operation
from blockchain.tests.outgoing_fixtures import (
    BLOCK_HASH,
    CHAIN_ID,
    admitted_signer,
    chain_client,
    claim_operation,
    receipt,
    sign_claim,
)
from shared.db import current_alias

OTHER_HASH = "0x" + "cc" * 32
ZERO_HASH = "0x" + "00" * 32


class OutgoingReceiptInclusionTest(TransactionTestCase):
    def setUp(self):
        admitted_signer()
        self.sequence = 0

    def signed_operation(self):
        self.sequence += 1
        self.claim = claim_operation(f"receipt-inclusion:{self.sequence}")
        self.chain = chain_client()
        self.chain.w3 = SimpleNamespace(eth=SimpleNamespace(chain_id=CHAIN_ID))
        self.chain.get_block.return_value = {"number": 12, "hash": BLOCK_HASH}
        self.attempt = sign_claim(self.claim, self.chain)
        self.good_receipt = receipt(self.attempt)
        self.chain.get_transaction_receipt.return_value = self.good_receipt
        self.chain.reset_mock()
        self.saved_bytes = bytes(self.attempt.raw_transaction)
        self.saved_nonce = SigningAccount.objects.get().next_nonce
        self.saved_count = SignedAttempt.objects.count()

    def assert_original_attempt(self, status=OutgoingStatus.SIGNED):
        operation = OutgoingOperation.objects.get(pk=self.claim.operation_id)
        attempt = SignedAttempt.objects.get(pk=self.attempt.pk)
        self.assertEqual(operation.status, status)
        self.assertEqual(operation.claim_id, self.claim.claim_id)
        self.assertEqual(operation.current_attempt_id, self.attempt.pk)
        self.assertEqual(attempt.claim_id, self.claim.claim_id)
        self.assertEqual(attempt.nonce, self.attempt.nonce)
        self.assertEqual(attempt.tx_hash, self.attempt.tx_hash)
        self.assertEqual(bytes(attempt.raw_transaction), self.saved_bytes)
        self.assertEqual(SigningAccount.objects.get().next_nonce, self.saved_nonce)
        self.assertEqual(SignedAttempt.objects.count(), self.saved_count)
        self.chain.send_raw_transaction.assert_not_called()
        if status == OutgoingStatus.SIGNED:
            self.assertIsNone(operation.block_number)
            self.assertEqual(operation.block_hash, "")
            self.assertIsNone(operation.gas_used)

    def test_zero_hash_success_and_revert_remain_the_same_signed_attempt(self):
        for status in (1, 0):
            with self.subTest(status=status):
                self.signed_operation()
                self.chain.get_transaction_receipt.return_value = self.good_receipt | {
                    "status": status,
                    "blockHash": ZERO_HASH,
                }
                self.assertFalse(reconcile_operation(self.claim, self.chain))
                self.assert_original_attempt()

    def test_receipt_requires_matching_canonical_block_hash_and_height(self):
        for block in ({"number": 12, "hash": OTHER_HASH}, {"number": 13, "hash": BLOCK_HASH}):
            with self.subTest(block=block):
                self.signed_operation()
                self.chain.get_block.return_value = block
                self.assertFalse(reconcile_operation(self.claim, self.chain))
                self.assert_original_attempt()

    def test_unavailable_canonical_block_leaves_the_attempt_unresolved(self):
        self.signed_operation()
        self.chain.get_block.side_effect = ConnectionError("synthetic block read unavailable")
        self.assertFalse(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt()

    def test_changed_receipt_between_reads_cannot_complete_the_attempt(self):
        changes = {
            "transactionHash": OTHER_HASH,
            "blockNumber": 13,
            "blockHash": OTHER_HASH,
            "status": 0,
            "gasUsed": 21001,
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                self.signed_operation()
                self.chain.get_transaction_receipt.side_effect = [
                    self.good_receipt,
                    self.good_receipt | {field: value},
                ]
                self.assertFalse(reconcile_operation(self.claim, self.chain))
                self.assert_original_attempt()

    def test_receipt_disappearing_or_unavailable_on_reread_stays_unresolved(self):
        for second in (None, ConnectionError("synthetic receipt read unavailable")):
            with self.subTest(second=second):
                self.signed_operation()
                self.chain.get_transaction_receipt.side_effect = [self.good_receipt, second]
                self.assertFalse(reconcile_operation(self.claim, self.chain))
                self.assert_original_attempt()

    def test_canonical_block_changing_between_reads_stays_unresolved(self):
        self.signed_operation()
        self.chain.get_block.side_effect = [
            {"number": 12, "hash": BLOCK_HASH},
            {"number": 12, "hash": OTHER_HASH},
        ]
        self.assertFalse(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt()

    def test_chain_change_after_block_reads_stays_unresolved(self):
        self.signed_operation()
        reads = 0

        def block_by_height(height):
            nonlocal reads
            self.assertEqual(height, 12)
            reads += 1
            if reads == 2:
                self.chain.w3.eth.chain_id = 1
            return {"number": 12, "hash": BLOCK_HASH}

        self.chain.get_block.side_effect = block_by_height
        self.assertFalse(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt()

    def test_preconfirmation_then_canonical_inclusion_completes_original_once(self):
        self.signed_operation()
        self.chain.get_transaction_receipt.return_value = self.good_receipt | {"blockHash": ZERO_HASH}
        self.assertFalse(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt()

        self.chain.get_transaction_receipt.return_value = self.good_receipt
        self.assertTrue(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt(OutgoingStatus.CONFIRMED)
        operation = OutgoingOperation.objects.get(pk=self.claim.operation_id)
        self.assertEqual((operation.block_number, operation.block_hash, operation.gas_used), (12, BLOCK_HASH, 21000))
        self.chain.get_transaction_receipt.return_value = self.good_receipt | {"status": 0}
        self.assertFalse(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt(OutgoingStatus.CONFIRMED)

    def test_canonical_inclusion_does_not_require_the_finalized_head(self):
        self.signed_operation()

        def block_by_height(height):
            if height == "finalized":
                return {"number": 11, "hash": OTHER_HASH}
            self.assertEqual(height, 12)
            return {"number": 12, "hash": BLOCK_HASH}

        self.chain.get_block.side_effect = block_by_height
        self.assertTrue(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt(OutgoingStatus.CONFIRMED)
        self.assertEqual(self.chain.get_block.call_args_list, [call(12), call(12)])
        self.assertEqual(
            self.chain.get_transaction_receipt.call_args_list,
            [call(self.attempt.tx_hash), call(self.attempt.tx_hash)],
        )

    def test_all_observation_rpc_finishes_outside_database_transactions(self):
        self.signed_operation()
        observations = []

        def outside_transaction(name, answer):
            def read(*args):
                connection = connections[current_alias()]
                observations.append((name, connection.get_autocommit(), connection.in_atomic_block))
                return answer

            return read

        self.chain.assert_expected_chain.side_effect = outside_transaction("expected_chain", CHAIN_ID)
        self.chain.get_transaction_receipt.side_effect = outside_transaction("receipt", self.good_receipt)
        self.chain.get_block.side_effect = outside_transaction("block", {"number": 12, "hash": BLOCK_HASH})

        class Eth:
            chain_id = property(lambda _: outside_transaction("fresh_chain", CHAIN_ID)())

        self.chain.w3 = SimpleNamespace(eth=Eth())
        self.assertTrue(reconcile_operation(self.claim, self.chain))
        self.assert_original_attempt(OutgoingStatus.CONFIRMED)
        self.assertTrue(observations)
        self.assertIn("fresh_chain", [name for name, _, _ in observations])
        self.assertTrue(all(autocommit and not in_atomic for _, autocommit, in_atomic in observations))
