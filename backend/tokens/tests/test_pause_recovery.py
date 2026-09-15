from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import BLOCK_HASH, CHAIN_ID, KEY
from companies.models import Company
from tokens.exceptions import PauseChangeConflict
from tokens.models import PauseChange, ShareToken
from tokens.services import pause_changes, pause_recovery
from tokens.tasks.pause import check_pending_pause_changes
from tokens.tests.pause_fixtures import install_pause


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class PauseRecoveryTest(TransactionTestCase):
    def setUp(self):
        install_pause(self)

    def recover(self, change=None):
        return pause_recovery.recover((change or self.change).pk)

    def submit(self, paused):
        self.token.refresh_from_db()
        return pause_changes.submit(self.token, self.tenant.user, uuid4(), paused)

    def test_pause_unpause_pause_cycles_use_distinct_intent_and_terminal_replay_cannot_undo_them(self):
        first = self.recover()
        self.assertEqual(first.status, "confirmed")
        self.assertIsNotNone(first.completed_at)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "paused")
        second = self.submit(False)
        self.assertEqual(self.recover(second).status, "confirmed")
        self.assertEqual(self.recover().status, "confirmed")
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")
        self.assertEqual(len(self.node.broadcasts), 2)
        third = self.submit(True)
        self.assertEqual(self.recover(third).status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 3)
        self.assertEqual(OutgoingOperation.objects.count(), 3)
        self.node.client.send_transaction.assert_not_called()

    def test_observed_state_has_block_evidence_but_no_transaction_and_never_reprojects(self):
        self.node.paused = True
        change = self.recover()
        self.assertEqual(change.status, "observed")
        self.assertIsNotNone(change.completed_at)
        self.assertIsNone(change.operation_id)
        self.assertEqual(change.observation["block_hash"], BLOCK_HASH)
        self.node.contract.functions.paused.return_value.call.assert_called_once_with(block_identifier=BLOCK_HASH)
        self.assertFalse(SignedAttempt.objects.exists())
        self.recover(self.submit(False))
        self.recover()
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")

    def test_signed_uncertainty_refuses_both_new_intents_and_never_adopts_current_state(self):
        self.node.confirmed = False
        self.assertIsNone(self.recover().completed_at)
        attempt = SignedAttempt.objects.get()
        self.node.paused = True
        self.assertEqual(self.recover().status, "executing")
        refusals = []
        for paused in (True, False):
            refused = self.submit(paused)
            refusals.append(refused)
            self.assertEqual(refused.status, "failed")
            self.assertIsNotNone(refused.completed_at)
            self.assertIsNone(refused.operation_id)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)
        self.node.receipts[attempt.tx_hash] = self.node.receipt(attempt)
        self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 2)
        self.node.confirmed = True
        self.assertEqual(self.recover(self.submit(False)).status, "confirmed")
        for refused in refusals:
            replay = pause_changes.submit(self.token, self.tenant.user, refused.pk, refused.paused)
            self.assertEqual((replay.status, replay.completed_at), (refused.status, refused.completed_at))
            self.recover(replay)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 2)

    def test_bounded_sweep_moves_past_an_old_failure_and_excludes_fresh_and_completed_requests(self):
        completed = self.submit(False)
        later = []
        for digit in ("d", "e"):
            token = ShareToken.objects.create(
                company=self.token.company,
                name="Sweep token",
                symbol=digit.upper(),
                total_supply="100",
                status="deployed",
                chain="base",
                contract_address="0x" + digit * 40,
            )
            later.append(pause_changes.submit(token, self.tenant.user, uuid4(), True))
        old = timezone.now() - timedelta(hours=1)
        PauseChange.objects.filter(pk=self.change.pk).update(updated_at=old)
        PauseChange.objects.filter(pk=later[0].pk).update(updated_at=old + timedelta(minutes=1))
        PauseChange.objects.filter(pk=completed.pk).update(updated_at=old - timedelta(minutes=1))
        with patch("tokens.tasks.pause.PAUSE_RECOVERY_BATCH", 1), patch.object(
            pause_recovery, "get_base_chain_client", side_effect=ConnectionError("Synthetic provider unavailable")
        ) as provider:
            self.assertEqual(check_pending_pause_changes(), {"checked": 1, "completed": 0})
            provider.assert_called_once_with()
        self.node.paused = True
        with patch("tokens.tasks.pause.PAUSE_RECOVERY_BATCH", 1):
            self.assertEqual(check_pending_pause_changes(), {"checked": 1, "completed": 1})
        self.change.refresh_from_db()
        later[0].refresh_from_db()
        later[1].refresh_from_db()
        self.assertEqual((self.change.status, self.change.completed_at), ("pending", None))
        self.assertEqual(later[0].status, "observed")
        self.assertIsNotNone(later[0].completed_at)
        self.assertEqual((later[1].status, later[1].completed_at), ("pending", None))
        self.assertFalse(SignedAttempt.objects.exists())

    def test_lost_send_response_retains_original_transaction(self):
        self.node.lose_acknowledgement = True
        self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_decided_execution_cannot_later_become_an_observation(self):
        with patch.object(pause_recovery, "_claim", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        self.node.paused = True
        self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.change.refresh_from_db()
        self.assertIsNone(self.change.observation)

    def test_open_operation_commit_loss_reuses_unbound_operation(self):
        original = outgoing.open_operation

        def committed_then_stop(*args, **kwargs):
            original(*args, **kwargs)
            raise SystemExit

        with patch.object(outgoing, "open_operation", side_effect=committed_then_stop):
            with self.assertRaises(SystemExit):
                self.recover()
        operation = OutgoingOperation.objects.get()
        self.change.refresh_from_db()
        self.assertIsNone(self.change.operation_id)
        self.assertEqual(self.recover().operation_id, operation.pk)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_signed_commit_loss_recovers_without_a_second_nonce(self):
        original = outgoing.sign_operation

        def committed_then_stop(*args, **kwargs):
            original(*args, **kwargs)
            raise SystemExit

        with patch.object(outgoing, "sign_operation", side_effect=committed_then_stop):
            with self.assertRaises(SystemExit):
                self.recover()
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])

    def test_failed_signing_boundary_does_not_commit_a_nonce_or_send(self):
        before = SigningAccount.objects.get().next_nonce
        with patch.object(pause_recovery, "_record_signed", side_effect=DatabaseError("Synthetic guard failure")):
            self.assertEqual(self.recover().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, before)
        self.assertEqual(self.node.broadcasts, [])

    def test_lost_signed_commit_acknowledgement_follows_the_committed_attempt_instead_of_failing_it(self):
        original = outgoing.sign_operation

        def committed_then_disconnect(*args, **kwargs):
            original(*args, **kwargs)
            raise DatabaseError("Synthetic translated signed commit acknowledgement loss")

        with patch.object(outgoing, "sign_operation", side_effect=committed_then_disconnect):
            self.assertEqual(self.recover().status, "confirmed")
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)

    def test_revert_is_permanent_and_deliberate_retry_gets_a_new_submission(self):
        self.node.receipt_status = 0
        self.assertEqual(self.recover().status, "failed")
        original = SignedAttempt.objects.get()
        self.assertEqual(self.recover().status, "failed")
        self.node.receipt_status = 1
        self.assertEqual(self.recover(self.submit(True)).status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        original.operation.refresh_from_db()
        self.assertEqual((original.operation.status, original.operation.block_hash), ("reverted", BLOCK_HASH))

    def test_revert_projection_recovers_without_a_provider(self):
        self.node.receipt_status = 0
        with patch.object(pause_recovery, "_record_outcome", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        with patch.object(pause_recovery, "get_base_chain_client", side_effect=AssertionError("No RPC for failure")):
            self.assertEqual(self.recover().status, "failed")

    def test_unprojected_outcome_keeps_opposite_blocked_and_recovery_uses_retained_evidence(self):
        with patch.object(pause_changes, "project", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, "confirmed")
        self.assertIsNone(self.change.completed_at)
        refused = self.submit(False)
        self.assertEqual(refused.status, "failed")
        self.assertIsNotNone(refused.completed_at)
        with patch.object(pause_recovery, "get_base_chain_client", side_effect=AssertionError("Retained outcome")):
            self.assertIsNotNone(self.recover().completed_at)

    def test_completed_commit_response_loss_is_recovered_without_reprojection(self):
        original = pause_changes.project

        def committed_then_stop(*args, **kwargs):
            original(*args, **kwargs)
            raise SystemExit

        with patch.object(pause_changes, "project", side_effect=committed_then_stop):
            with self.assertRaises(SystemExit):
                self.recover()
        self.recover(self.submit(False))
        with patch.object(pause_changes, "project", side_effect=AssertionError("Terminal replay cannot project")):
            self.assertIsNotNone(self.recover().completed_at)

    def test_mismatched_and_ambiguous_event_cannot_resolve_signed_uncertainty(self):
        self.node.event_changes = {"account": "0x" + "e" * 40}
        with self.assertRaisesMessage(PauseChangeConflict, "unique event"):
            self.recover()
        self.node.event_changes = {}
        for count in (0, 2):
            self.node.event_count = count
            with self.assertRaisesMessage(PauseChangeConflict, "unique event"):
                self.recover()
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, "executing")
        self.node.event_count = 1
        self.assertEqual(self.recover().status, "confirmed")

    def test_fresh_owner_check_prevents_signing_after_admission(self):
        replacement = get_user_model().objects.create_user(email="replacement@example.test", is_active=True)
        Company.objects.filter(pk=self.token.company_id).update(owner=replacement)
        self.assertEqual(self.recover().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])
        self.assertIsNotNone(PauseChange.objects.get(pk=self.change.pk).completed_at)
        replacement_change = pause_changes.submit(self.token, replacement, uuid4(), True)
        self.assertEqual(self.recover(replacement_change).status, "confirmed")

    def test_unsigned_wrong_chain_is_refused_and_cannot_hold_later_authorized_work(self):
        self.node.client.assert_expected_chain.return_value = CHAIN_ID + 1
        self.assertEqual(self.recover().status, "failed")
        self.assertFalse(OutgoingOperation.objects.exists())
        self.node.client.assert_expected_chain.return_value = CHAIN_ID
        self.assertEqual(self.recover(self.submit(True)).status, "confirmed")

    def test_transient_provider_failure_keeps_the_unsigned_submission_recoverable(self):
        self.node.client.get_block.side_effect = ConnectionError("Synthetic temporary provider outage")
        with self.assertRaises(ConnectionError):
            self.recover()
        self.change.refresh_from_db()
        self.assertEqual((self.change.status, self.change.completed_at), ("pending", None))
        self.node.client.get_block.side_effect = None
        self.assertEqual(self.recover().status, "confirmed")

    def test_delayed_unsigned_refusal_cannot_release_a_peer_signing_decision(self):
        with patch.object(pause_recovery, "_claim", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        current = pause_changes.refuse_unsigned(self.change)
        self.assertEqual((current.status, current.completed_at), ("executing", None))
        self.assertEqual(self.recover().status, "confirmed")

    def test_wrong_chain_or_untyped_state_never_admits_signing(self):
        for value in (1, None, "true"):
            self.node.paused = value
            with self.assertRaises(PauseChangeConflict):
                self.recover()
        self.assertFalse(OutgoingOperation.objects.exists())

    def test_changed_signer_cannot_sign_but_original_signed_receipt_still_recovers(self):
        self.node.confirmed = False
        self.recover()
        attempt = SignedAttempt.objects.get()
        self.node.receipts[attempt.tx_hash] = self.node.receipt(attempt)
        with override_settings(BLOCKCHAIN_OPERATOR_KEY=""):
            self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_observed_outcome_withheld_by_changed_target_keeps_the_barrier(self):
        self.node.paused = True
        with patch.object(pause_changes, "project", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.recover()
        self.token.chain = "ethereum"
        self.token.save(update_fields=["chain"])
        with self.assertRaises(PauseChangeConflict):
            self.recover()
        self.assertIsNone(PauseChange.objects.get(pk=self.change.pk).completed_at)
