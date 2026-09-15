from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from shared.db import atomic
from tokens.exceptions import InvalidTokenStateException
from tokens.models import TokenDeployment
from tokens.services import swap_approval
from tokens.tests.deployment_fixtures import CHAIN_ID, CREATED, FACTORY, KEY
from tokens.tests.swap_approval_fixtures import SWAP, approval_receipt, install_approval


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    ATOMIC_SWAP_ADDRESS=SWAP,
)
class SwapApprovalRecoveryTest(TransactionTestCase):
    def setUp(self):
        install_approval(self)

    def recover(self):
        return swap_approval.recover(self.command.pk)

    def approval_attempts(self):
        return SignedAttempt.objects.filter(operation__operation_key=f"swap-approval:{self.command.pk}")

    def test_confirmation_retains_separate_transaction_and_deployment(self):
        deployment_fields = (
            self.command.intent,
            self.command.operation_id,
            self.command.transaction_id,
            self.command.projected_at,
        )
        self.assertEqual(self.recover(), "confirmed")
        self.command.refresh_from_db()
        self.assertEqual(
            (self.command.intent, self.command.operation_id, self.command.transaction_id, self.command.projected_at),
            deployment_fields,
        )
        record = self.command.approval_transaction
        self.assertEqual(
            (record.status, record.block_number, record.block_hash, record.gas_used),
            ("confirmed", 12, BLOCK_HASH, 21000),
        )
        self.assertEqual(record.function_args, {"token": CREATED.lower(), "approved": True})
        self.assertEqual(record.nonce, self.approval_attempts().get().nonce)
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(len(self.approval_node.broadcasts), 1)
        self.approval_node.client.send_transaction.assert_not_called()

    def test_existing_approval_records_observation_without_transaction(self):
        self.approval_node.approved = True
        self.assertEqual(self.recover(), "observed_approved")
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_observation["block_number"], 11)
        self.assertEqual(self.command.approval_observation["block_hash"], BLOCK_HASH)
        self.assertIn("observed_at", self.command.approval_observation)
        self.approval_node.contract.functions.approvedShareTokens.return_value.call.assert_called_once_with(
            block_identifier=BLOCK_HASH
        )
        self.assertIsNone(self.command.approval_operation_id)
        self.assertIsNone(self.command.approval_transaction_id)
        self.assertEqual(self.approval_node.broadcasts, [])
        self.approval_node.approved = False
        self.assertEqual(self.recover(), "observed_approved")
        self.assertEqual(self.approval_node.broadcasts, [])

    def test_signed_uncertainty_cannot_be_replaced_by_current_approval(self):
        self.approval_node.confirmed = False
        self.assertEqual(self.recover(), "executing")
        original = self.approval_attempts().get()
        self.approval_node.approved = True
        self.assertEqual(self.recover(), "executing")
        self.command.refresh_from_db()
        self.assertIsNone(self.command.approval_observation)
        self.assertEqual(self.approval_node.broadcasts, [bytes(original.raw_transaction)] * 2)
        self.assertEqual(self.approval_attempts().count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, original.nonce + 1)
        self.approval_node.receipts[original.tx_hash] = approval_receipt(original)
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(len(self.approval_node.broadcasts), 2)

    def test_lost_send_acknowledgement_recovers_original_receipt(self):
        self.approval_node.lose_acknowledgement = True
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(self.approval_attempts().count(), 1)

    def test_unsigned_decision_prevents_later_observation_from_adopting_peer_state(self):
        with patch.object(swap_approval, "_claim", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        self.approval_node.approved = True
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(self.approval_attempts().count(), 1)
        self.command.refresh_from_db()
        self.assertIsNone(self.command.approval_observation)

    def test_open_before_bind_resumes_original_operation(self):
        original = outgoing.open_operation

        def committed_then_stop(*args, **kwargs):
            original(*args, **kwargs)
            raise SystemExit

        with patch.object(outgoing, "open_operation", side_effect=committed_then_stop):
            with self.assertRaises(SystemExit):
                self.recover()
        operation = OutgoingOperation.objects.get(operation_key=f"swap-approval:{self.command.pk}")
        self.command.refresh_from_db()
        self.assertIsNone(self.command.approval_operation_id)
        self.assertEqual(self.recover(), "confirmed")
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_operation_id, operation.pk)

    def test_signed_commit_acknowledgement_loss_does_not_fail_or_sign_again(self):
        original = outgoing.sign_operation

        def committed_then_disconnect(*args, **kwargs):
            original(*args, **kwargs)
            raise ConnectionError("Synthetic signed commit acknowledgement loss")

        with patch.object(outgoing, "sign_operation", side_effect=committed_then_disconnect):
            with self.assertRaises(ConnectionError):
                self.recover()
        attempt = self.approval_attempts().get()
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_transaction.tx_hash, attempt.tx_hash)
        self.assertEqual(self.approval_node.broadcasts, [])
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(self.approval_attempts().count(), 1)

    def test_transaction_association_failure_rolls_back_signed_bytes_and_nonce(self):
        before = SigningAccount.objects.get().next_nonce
        with patch.object(swap_approval, "_record_signed", side_effect=DatabaseError("Synthetic association failure")):
            with self.assertRaises(outgoing.OutgoingTransactionError):
                self.recover()
        self.assertFalse(self.approval_attempts().exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, before)
        self.assertEqual(self.approval_node.broadcasts, [])
        self.assertEqual(self.recover(), "confirmed")

    def test_reverted_receipt_is_retained_before_explicit_exact_retry(self):
        self.approval_node.receipt_status = 0
        self.assertEqual(self.recover(), "failed")
        self.command.refresh_from_db()
        previous = self.command.approval_transaction
        self.assertEqual(
            (previous.status, previous.block_number, previous.block_hash, previous.gas_used),
            ("reverted", 12, BLOCK_HASH, 21000),
        )
        claim = self.command.approval_operation.claim_id
        self.assertEqual(self.recover(), "failed")
        self.assertEqual(len(self.approval_node.broadcasts), 1)
        actor = get_user_model().objects.create_superuser(email="approval@example.com", password="test")
        confirmation = swap_approval.retry_confirmation(self.token, actor)
        swap_approval.retry(self.token, actor, confirmation)
        self.approval_node.receipt_status = 1
        self.assertEqual(self.recover(), "confirmed")
        self.command.refresh_from_db()
        self.assertNotEqual(self.command.approval_operation.claim_id, claim)
        self.assertNotEqual(self.command.approval_transaction_id, previous.pk)
        previous.refresh_from_db()
        self.assertEqual((previous.status, previous.block_hash), ("reverted", BLOCK_HASH))
        self.assertEqual(swap_approval.retry(self.token, actor, confirmation), "confirmed")
        self.assertEqual(self.approval_attempts().count(), 2)

    def test_reverted_outcome_projection_can_resume_without_provider(self):
        self.approval_node.receipt_status = 0
        with patch.object(swap_approval, "_record_outcome", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        with patch.object(
            swap_approval, "get_base_chain_client", side_effect=AssertionError("No RPC for retained revert")
        ):
            self.assertEqual(self.recover(), "failed")
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_transaction.status, "reverted")

    def test_mismatched_and_ambiguous_events_leave_approval_unresolved(self):
        for changes in ({"token": "0x" + "e" * 40}, {"approved": False}):
            self.approval_node.event_changes = changes
            with self.assertRaisesMessage(InvalidTokenStateException, "unique event"):
                self.recover()
        self.approval_node.event_changes = {}
        for count in (0, 2):
            self.approval_node.event_count = count
            with self.assertRaisesMessage(InvalidTokenStateException, "unique event"):
                self.recover()
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_outcome, "executing")
        self.assertEqual(len(self.approval_node.broadcasts), 1)
        self.approval_node.event_count = 1
        self.assertEqual(self.recover(), "confirmed")

    def test_configuration_change_refuses_fresh_approval_but_recovers_recorded_receipt(self):
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "e" * 40):
            with self.assertRaises(InvalidTokenStateException):
                self.recover()
        self.assertFalse(self.approval_attempts().exists())
        self.approval_node.confirmed = False
        self.recover()
        attempt = self.approval_attempts().get()
        self.approval_node.receipts[attempt.tx_hash] = approval_receipt(attempt)
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "e" * 40, BLOCKCHAIN_OPERATOR_KEY=""):
            self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(len(self.approval_node.broadcasts), 1)

    def test_wrong_observation_chain_or_untyped_state_does_not_admit_signing(self):
        self.approval_node.client.assert_expected_chain.return_value = CHAIN_ID + 1
        with self.assertRaises(InvalidTokenStateException):
            self.recover()
        self.approval_node.client.assert_expected_chain.return_value = CHAIN_ID
        self.approval_node.approved = 1
        with self.assertRaises(InvalidTokenStateException):
            self.recover()
        self.assertFalse(self.approval_attempts().exists())
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_outcome, "pending")

    def test_database_refuses_retargeting_or_observation_over_a_signed_attempt(self):
        self.approval_node.confirmed = False
        self.recover()
        self.command.refresh_from_db()
        for changes in (
            {"approval_intent": self.command.approval_intent | {"to": "0x" + "e" * 40}},
            {
                "approval_outcome": "observed_approved",
                "approval_observation": {"block_number": 12, "block_hash": BLOCK_HASH, "observed_at": "now"},
            },
            {"approval_operation": None},
            {"approval_transaction": None},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                TokenDeployment.objects.filter(pk=self.command.pk).update(**changes)

    def test_generic_transaction_monitor_excludes_the_approval(self):
        self.approval_node.confirmed = False
        self.recover()
        self.command.refresh_from_db()
        self.assertFalse(
            BlockchainTransaction.objects.without_outgoing_operations()
            .filter(pk=self.command.approval_transaction_id)
            .exists()
        )

    def test_receipt_envelope_must_retain_the_original_sender_and_target(self):
        self.approval_node.confirmed = False
        self.recover()
        attempt = self.approval_attempts().get()
        for field in ("from", "to"):
            self.approval_node.receipts[attempt.tx_hash] = approval_receipt(attempt) | {field: "0x" + "e" * 40}
            with self.subTest(field=field), self.assertRaises(InvalidTokenStateException):
                self.recover()
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_outcome, "executing")

    def test_retry_rechecks_the_current_actor_instead_of_cached_authority(self):
        self.approval_node.receipt_status = 0
        self.recover()
        actor = get_user_model().objects.create_superuser(email="revoked@example.com", password="test")
        confirmation = swap_approval.retry_confirmation(self.token, actor)
        get_user_model().objects.filter(pk=actor.pk).update(is_active=False)
        with self.assertRaises(InvalidTokenStateException):
            swap_approval.retry(self.token, actor, confirmation)
        self.command.refresh_from_db()
        self.assertEqual(self.command.approval_outcome, "failed")
