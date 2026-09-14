from datetime import timedelta
from unittest.mock import patch

from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import receipt
from shared.db import atomic, current_alias
from tokens.exceptions import CapitalIncreaseConflict, CapitalIncreaseUnresolved
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest, ShareToken
from tokens.services import capital_execution, share_token_service
from tokens.tasks import execute_review_request_task, recover_capital_increases
from tokens.tests.capital_fixtures import (
    CHAIN_ID,
    KEY,
    admit,
    capital_request,
    install_capital,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class CapitalExecutionRecoveryTest(TransactionTestCase):
    def setUp(self):
        install_capital(self)

    def execute(self, **options):
        command = admit(self.request, self.actor, **options)
        return capital_execution.recover(command.pk)

    def test_success_requires_original_receipt_and_replay_cannot_lower_a_later_cap(self):
        result = self.execute()
        self.assertEqual(result["status"], "executed")
        self.assertEqual(result["tx_hash"], SignedAttempt.objects.get().tx_hash)
        self.token.refresh_from_db()
        self.assertEqual(int(self.token.total_supply), 1100)
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertFalse(self.token.issuances.exists())
        self.token.total_supply = "1200"
        self.token.save(update_fields=["total_supply"])
        self.assertEqual(self.execute(), result)
        self.token.refresh_from_db()
        self.assertEqual(int(self.token.total_supply), 1200)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.node.client.send_transaction.assert_not_called()

    def test_unknown_send_retains_original_bytes_nonce_and_public_hold(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.assertEqual(self.execute()["status"], "executing")
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.execute()["status"], "executing")
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)
        self.token.refresh_from_db()
        self.assertEqual(int(self.token.total_supply), 1000)

    def test_lost_send_acknowledgement_uses_original_receipt(self):
        self.node.lose_acknowledgement = True
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_cap_reads_broadcast_and_receipts_leave_rows_unlocked_on_an_independent_connection(self):
        current = connections[current_alias()]
        probe = current.copy(alias="capital-rpc-probe")
        self.addCleanup(probe.close)
        with current.cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid()")
            original_pid = cursor.fetchone()[0]
        seen = []

        def checked(name, callback):
            def call(*args, **kwargs):
                self.assertTrue(current.get_autocommit())
                self.assertFalse(current.in_atomic_block)
                probe.set_autocommit(False)
                try:
                    with probe.cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        self.assertNotEqual(cursor.fetchone()[0], original_pid)
                        for model in (
                            CapitalIncreaseRequest,
                            CapitalIncreaseExecution,
                            ShareToken,
                            OutgoingOperation,
                            SigningAccount,
                        ):
                            cursor.execute(f"SELECT * FROM {model._meta.db_table} FOR UPDATE NOWAIT")
                            self.assertTrue(cursor.fetchall(), model._meta.label)
                finally:
                    probe.rollback()
                    probe.set_autocommit(True)
                seen.append(name)
                return callback(*args, **kwargs)

            return call

        self.node.contract.functions.authorizedShares.return_value.call.side_effect = checked(
            "cap", lambda: self.node.cap
        )
        self.node.client.send_raw_transaction.side_effect = checked("send", self.node.send)
        self.node.client.get_transaction_receipt.side_effect = checked("receipt", self.node.receipts.get)
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(set(seen), {"cap", "send", "receipt"})

    def test_matching_unattributed_cap_remains_held_even_after_restoration(self):
        self.node.cap = 1100
        self.assertTrue(self.execute()["attribution_required"])
        command = CapitalIncreaseExecution.objects.get()
        evidence = command.attribution_evidence
        self.assertEqual(evidence["source"], "chain")
        self.node.cap = 1000
        result = capital_execution.recover(command.pk)
        self.assertEqual(result["status"], "executing")
        self.assertTrue(result["attribution_required"])
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
        self.request.refresh_from_db()
        self.request.execution_notes = "Operator changed the public notes"
        self.request.save(update_fields=["execution_notes"])
        command.refresh_from_db()
        self.assertEqual(command.attribution_evidence, evidence)
        for replacement in (None, evidence | {"source": "replacement"}):
            with self.assertRaises(DatabaseError), atomic():
                CapitalIncreaseExecution.objects.filter(pk=command.pk).update(attribution_evidence=replacement)

    def test_unsigned_failure_requires_exact_explicit_retry(self):
        original_form = capital_execution.confirmation(self.request, self.actor)
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation failure")
        self.assertEqual(self.execute(confirmed=original_form)["status"], "failed")
        first_claim = OutgoingOperation.objects.get().claim_id
        self.node.client.estimate_gas.side_effect = None
        self.assertEqual(self.execute(confirmed=original_form)["status"], "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.execute()["status"], "executed")
        self.assertNotEqual(OutgoingOperation.objects.get().claim_id, first_claim)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_replayed_retry_form_cannot_authorize_another_failed_attempt(self):
        self.node.receipt_status = 0
        self.assertEqual(self.execute()["status"], "failed")
        first = SignedAttempt.objects.get()
        form = capital_execution.confirmation(self.request, self.actor)
        self.assertEqual(self.execute(confirmed=form)["status"], "failed")
        second_claim = OutgoingOperation.objects.get().claim_id
        self.assertEqual(self.execute(confirmed=form)["status"], "failed")
        self.assertEqual(OutgoingOperation.objects.get().claim_id, second_claim)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(BlockchainTransaction.objects.filter(status="reverted").count(), 2)
        self.assertEqual(SignedAttempt.objects.get(pk=first.pk).tx_hash, first.tx_hash)

    def test_confirmation_loaded_while_executing_cannot_authorize_a_later_revert_retry(self):
        self.node.confirmed = False
        self.assertEqual(self.execute()["status"], "executing")
        shown_while_executing = capital_execution.confirmation(self.request, self.actor)
        attempt = SignedAttempt.objects.get()
        intent = CapitalIncreaseExecution.objects.get().intent
        self.node.receipts[attempt.tx_hash] = receipt(attempt, 0) | {"to": intent["to"], "from": intent["sender"]}
        self.assertEqual(capital_execution.recover(self.request.dispatch_id)["status"], "failed")
        self.assertEqual(self.execute(confirmed=shown_while_executing)["status"], "failed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.node.confirmed = True
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_worker_stop_after_admitted_retry_keeps_slot_and_recovers_original_authorization(self):
        self.node.receipt_status = 0
        self.execute()
        previous_claim = OutgoingOperation.objects.get().claim_id
        command = admit(self.request, self.actor)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(command.retry_of, previous_claim)
        self.node.receipt_status = 1
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executed")
        self.assertEqual(BlockchainTransaction.objects.filter(status="reverted").count(), 1)
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_lost_signed_commit_acknowledgement_recovers_original_attempt(self):
        original = outgoing.sign_operation

        def committed_then_lost(*args, **kwargs):
            original(*args, **kwargs)
            raise ConnectionError("Synthetic commit acknowledgement loss")

        with patch.object(outgoing, "sign_operation", side_effect=committed_then_lost):
            self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_signed_callback_rollback_does_not_consume_nonce_or_link_a_transaction(self):
        original = capital_execution._record_signed

        def rolled_back(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("Synthetic callback rollback")

        with patch.object(capital_execution, "_record_signed", side_effect=rolled_back):
            self.assertEqual(self.execute()["status"], "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertFalse(BlockchainTransaction.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, 0)

    def test_failed_committed_state_read_does_not_prove_unsigned_failure(self):
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation error")
        with patch.object(capital_execution, "_preparation_failed", side_effect=DatabaseError("Synthetic lost DB")):
            with self.assertRaises(DatabaseError):
                self.execute()
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(OutgoingOperation.objects.get().status, "preparing")

    def test_receipt_event_mismatch_cannot_project_cap_from_current_chain_state(self):
        self.node.events_missing = True
        with self.assertRaises(CapitalIncreaseUnresolved):
            self.execute()
        self.request.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(int(self.token.total_supply), 1000)
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.node.events_missing = False
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_admitted_identity_cap_and_terms_are_immutable_but_pause_remains_available(self):
        command = admit(self.request, self.actor)
        for changes in ({"total_supply": "1100"}, {"contract_address": "0x" + "b" * 40}, {"chain": "other"}):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                ShareToken.objects.filter(pk=self.token.pk).update(**changes)
        for changes in ({"status": "failed"}, {"status": "draft"}, {"additional_shares": 999}):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                CapitalIncreaseRequest.objects.filter(pk=self.request.pk).update(**changes)
        with self.assertRaises(DatabaseError), atomic():
            self.request.delete()
        ShareToken.objects.filter(pk=self.token.pk).update(status="paused")
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executed")

    def test_enclosing_transaction_and_current_nonstaff_cannot_admit(self):
        form = capital_execution.confirmation(self.request, self.actor)
        with atomic(), self.assertRaises(CapitalIncreaseConflict):
            admit(self.request, self.actor, confirmed=form)
        self.actor.is_staff = False
        self.actor.save(update_fields=["is_staff"])
        with self.assertRaises(PermissionDenied):
            admit(self.request, self.actor, confirmed=form)
        self.assertFalse(CapitalIncreaseExecution.objects.exists())

    def test_old_task_and_removed_sender_cannot_start_capital_execution(self):
        outcome = execute_review_request_task(
            model_label=self.request._meta.label, request_uuid=str(self.request.pk), executed_by=self.actor.pk
        )
        self.assertFalse(outcome["success"])
        with self.assertRaisesMessage(Exception, "own admitted execution"):
            share_token_service.execute_request(self.request, executed_by=self.actor)
        self.assertFalse(CapitalIncreaseExecution.objects.exists())

    def test_sweep_recovers_committed_admission_without_renewing_actor_authority(self):
        command = admit(self.request, self.actor)
        self.actor.is_active = False
        self.actor.save(update_fields=["is_active"])
        CapitalIncreaseExecution.objects.filter(pk=command.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(recover_capital_increases(), {"checked": 1, "resolved": 1})
        self.assertEqual(recover_capital_increases(), {"checked": 0, "resolved": 0})

    def test_contradicting_original_cap_event_retains_receipt_and_immutable_attribution(self):
        self.node.event_changes = {"oldAmount": 900}
        result = self.execute()
        self.assertEqual(result["status"], "executing")
        self.assertTrue(result["attribution_required"])
        record = BlockchainTransaction.objects.get()
        command = CapitalIncreaseExecution.objects.get()
        self.assertEqual(record.status, "confirmed")
        self.assertEqual(command.attribution_evidence["source"], "receipt")
        self.assertEqual(command.attribution_evidence["observed"]["tx_hash"], record.tx_hash)
        self.node.event_changes = {}
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executing")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_generic_monitor_cannot_overwrite_the_original_capital_projection(self):
        self.node.confirmed = False
        self.execute()
        record = BlockchainTransaction.objects.get()
        self.assertFalse(
            BlockchainTransaction.objects.pending().without_outgoing_operations().filter(pk=record.pk).exists()
        )

    def test_bounded_recovery_advances_past_an_unresolved_command(self):
        first = admit(self.request, self.actor)
        other, actor = capital_request("later-capital")
        second = admit(other.capital_increase, actor)
        CapitalIncreaseExecution.objects.filter(pk=first.pk).update(updated_at=timezone.now() - timedelta(hours=2))
        CapitalIncreaseExecution.objects.filter(pk=second.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        with patch("tokens.tasks.review_request.CAPITAL_RECOVERY_BATCH", 1):
            with patch.object(capital_execution, "recover", return_value={"status": "executing"}) as recover:
                self.assertEqual(recover_capital_increases(), {"checked": 1, "resolved": 0})
                self.assertEqual(recover_capital_increases(), {"checked": 1, "resolved": 0})
        self.assertEqual([call.args[0] for call in recover.call_args_list], [first.pk, second.pk])
