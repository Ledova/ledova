from unittest.mock import patch

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from shared.db import atomic
from tokens.exceptions import IssuanceExecutionConflict, IssuanceExecutionUnresolved
from tokens.models import ShareIssuance, ShareIssuanceExecution, ShareIssuanceRequest
from tokens.services import issuance_execution
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY, admit, install_issuance


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class IssuanceExecutionRecoveryTest(TransactionTestCase):
    def setUp(self):
        install_issuance(self)

    def execute(self, **options):
        command = admit(self.request, self.actor, **options)
        return issuance_execution.recover(command.pk)

    def test_success_and_replay_retain_original_receipt_bytes_and_supply(self):
        result = self.execute()
        self.assertEqual(result["status"], "executed")
        self.assertEqual(result["tx_hash"], SignedAttempt.objects.get().tx_hash)
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertEqual(ShareIssuance.objects.get().amount, str(self.request.amount))
        self.assertEqual(self.execute(), result)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.node.client.send_transaction.assert_not_called()

    def test_unknown_send_replays_original_bytes_without_another_nonce(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.assertEqual(self.execute()["status"], "executing")
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.execute()["status"], "executing")
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)

    def test_lost_send_acknowledgement_recovers_original_receipt(self):
        self.node.lose_acknowledgement = True
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_missing_mint_event_retains_receipt_and_execution_hold(self):
        self.node.events_missing = True
        with self.assertRaises(IssuanceExecutionUnresolved):
            self.execute()
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertEqual(ShareIssuanceExecution.objects.get().status, "executing")
        self.node.events_missing = False
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_revert_requires_confirmation_for_that_completed_failed_claim(self):
        before = issuance_execution.confirmation(self.request, self.actor)
        self.node.receipt_status = 0
        self.assertEqual(self.execute(confirmed=before)["status"], "failed")
        self.assertEqual(ShareIssuanceRequest.objects.unminted(self.token).share_total(), 0)
        self.assertFalse(ShareIssuance.objects.unconfirmed_request_uuids().exists())
        failed = issuance_execution.confirmation(self.request, self.actor)
        self.assertEqual(self.execute(confirmed=before)["status"], "failed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self.execute(confirmed=failed)["status"], "failed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(self.execute(confirmed=failed)["status"], "failed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        latest = issuance_execution.confirmation(self.request, self.actor)
        self.node.receipt_status = 1
        self.assertEqual(self.execute(confirmed=latest)["status"], "executed")
        self.assertEqual(
            list(BlockchainTransaction.objects.order_by("created_at").values_list("status", flat=True)),
            ["reverted", "reverted", "confirmed"],
        )

    def test_preflight_refusal_is_unsigned_failed_and_requires_explicit_retry(self):
        self.node.contract.functions.paused.return_value.call.return_value = True
        self.assertEqual(self.execute()["status"], "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
        self.assertEqual(OutgoingOperation.objects.get().status, "failed")
        confirmation = issuance_execution.confirmation(self.request, self.actor)
        self.node.contract.functions.paused.return_value.call.return_value = False
        self.assertEqual(self.execute(confirmed=confirmation)["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_recovery_continues_admitted_work_after_actor_deletion(self):
        command = admit(self.request, self.actor)
        original_actor = self.actor.pk
        self.actor.delete()
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        command.refresh_from_db()
        self.assertEqual(command.executed_by_id, original_actor)
        self.assertIsNone(ShareIssuance.objects.get().initiated_by_id)

    def test_admission_and_queue_rollback_together(self):
        with patch("tokens.tasks.execute_review_request_task.defer", side_effect=RuntimeError("queue failed")):
            with self.assertRaises(RuntimeError):
                issuance_execution.admit(
                    self.request, self.actor, confirmed=issuance_execution.confirmation(self.request, self.actor)
                )
        self.assertFalse(ShareIssuanceExecution.objects.exists())
        self.assertFalse(ShareIssuance.objects.exists())
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "approved")

    def test_admitted_request_cannot_be_retargeted_or_deleted(self):
        command = admit(self.request, self.actor)
        for fields in ({"amount": self.request.amount + 1}, {"dispatch_id": None}, {"status": "submitted"}):
            with self.assertRaises(DatabaseError), atomic():
                ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(**fields)
        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceExecution.objects.filter(pk=command.pk).delete()
        self.assertEqual(self.execute()["status"], "executed")

    def test_recovery_refuses_outer_transaction_before_provider_access(self):
        command = admit(self.request, self.actor)
        with atomic(), self.assertRaises(IssuanceExecutionConflict):
            issuance_execution.recover(command.pk)
        self.node.client.assert_expected_chain.assert_not_called()
        self.assertFalse(OutgoingOperation.objects.exists())

    def test_lost_signed_commit_acknowledgement_recovers_original_attempt(self):
        from blockchain.services import outgoing

        original = outgoing.sign_operation

        def committed_then_lost(*args, **kwargs):
            original(*args, **kwargs)
            raise ConnectionError("Synthetic commit acknowledgement loss")

        with patch.object(outgoing, "sign_operation", side_effect=committed_then_lost):
            self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_signed_callback_rollback_cannot_consume_nonce_or_broadcast(self):
        original = issuance_execution._record_signed

        def rolled_back(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("Synthetic callback rollback")

        with patch.object(issuance_execution, "_record_signed", side_effect=rolled_back):
            self.assertEqual(self.execute()["status"], "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertFalse(BlockchainTransaction.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
        self.assertFalse(self.node.broadcasts)

    def test_private_and_historical_journals_are_never_served_or_editable_in_admin(self):
        from django.contrib.admin import site
        from django.test import RequestFactory

        from tokens.admin.share_token import ShareIssuanceAdmin
        from tokens.serializers.share_issuance import ShareIssuanceListSerializer

        self.assertEqual(self.execute()["status"], "executed")
        issuance = ShareIssuance.objects.get()
        serialized = ShareIssuanceListSerializer(issuance).data
        self.assertNotIn("mint_journal", serialized)
        self.assertNotIn("raw_transaction", str(serialized))
        self.assertIn("tx_hash", serialized)
        request = RequestFactory().get("/")
        request.user = self.actor
        model_admin = ShareIssuanceAdmin(ShareIssuance, site)
        self.assertNotIn("mint_journal", model_admin.get_form(request, issuance).base_fields)
        self.assertNotIn("mint_journal", model_admin.get_fields(request, issuance))

    def test_new_unsigned_claim_is_never_released_by_historical_recovery(self):
        from tokens.services import legacy_issuance

        command = admit(self.request, self.actor)
        issuance_execution._start(command)
        self.assertIsNone(legacy_issuance.unnamed_mint(self.request))
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.resolve_executing_issuance(self.request)
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.release_unsigned_mint(self.request)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")

    def test_holding_seed_uses_original_contract_after_token_identity_changes(self):
        from tokens.models import ShareToken

        original = issuance_execution._project
        contract = self.token.contract_address

        def project_then_change(*args, **kwargs):
            result = original(*args, **kwargs)
            ShareToken.objects.filter(pk=self.token.pk).update(contract_address=self.tenant.wallet.address)
            return result

        with patch.object(issuance_execution, "_project", side_effect=project_then_change), patch(
            "tokens.services.share_token_service.seed_recipient_holding"
        ) as seed:
            self.assertEqual(self.execute()["status"], "executed")
        seed.assert_called_once_with(contract.lower(), self.request.recipient_address.lower())

    def test_whitelist_and_headroom_refusals_keep_actionable_safe_reasons(self):
        from tokens.services.share_token_service import (
            EXCEEDS_AUTHORIZED,
            NOT_WHITELISTED,
        )

        with patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=False):
            self.assertEqual(self.execute()["status"], "failed")
        self.request.refresh_from_db()
        self.assertIn(NOT_WHITELISTED, self.request.execution_notes)
        self.node.contract.functions.authorizedShares.return_value.call.return_value = self.request.amount - 1
        confirmed = issuance_execution.confirmation(self.request, self.actor)
        self.assertEqual(self.execute(confirmed=confirmed)["status"], "failed")
        self.request.refresh_from_db()
        self.assertIn(EXCEEDS_AUTHORIZED, self.request.execution_notes)
        self.assertFalse(SignedAttempt.objects.exists())
        self.node.contract.functions.authorizedShares.return_value.call.return_value = self.request.amount
        confirmed = issuance_execution.confirmation(self.request, self.actor)
        self.assertEqual(self.execute(confirmed=confirmed)["status"], "executed")

    def test_provider_error_cannot_publish_the_private_signed_payload(self):
        from web3 import Web3

        from tokens.serializers.share_issuance_request import (
            ShareIssuanceRequestSerializer,
        )

        def failed_send(raw):
            raise ConnectionError(Web3.to_hex(raw))

        self.node.client.send_raw_transaction.side_effect = failed_send
        self.assertEqual(self.execute()["status"], "executing")
        self.assertEqual(OutgoingOperation.objects.get().last_error, "ConnectionError")
        raw = Web3.to_hex(SignedAttempt.objects.get().raw_transaction)
        self.request.refresh_from_db()
        self.assertNotIn(raw, str(ShareIssuanceRequestSerializer(self.request).data))
        self.assertIsNone(ShareIssuance.objects.get().mint_journal)

    def test_generic_monitor_only_updates_historical_transactions(self):
        from unittest.mock import Mock

        from blockchain.services.transaction import check_pending_transactions

        self.node.confirmed = False
        self.assertEqual(self.execute()["status"], "executing")
        current = BlockchainTransaction.objects.get()
        before = BlockchainTransaction.objects.values().get(pk=current.pk)
        historical = BlockchainTransaction.objects.create(
            tx_hash="0x" + "71" * 32,
            status="submitted",
            from_address="0x" + "73" * 20,
            to_address="0x" + "74" * 20,
            nonce=7,
        )
        client = Mock()
        client.get_transaction_receipt.return_value = {
            "status": 1,
            "blockNumber": 77,
            "blockHash": "0x" + "72" * 32,
            "gasUsed": 21000,
        }
        result = check_pending_transactions(client)
        self.assertEqual(result, {"checked": 1, "confirmed": 1, "failed": 0})
        client.get_transaction_receipt.assert_called_once_with(historical.tx_hash)
        self.assertEqual(BlockchainTransaction.objects.values().get(pk=current.pk), before)
        historical.refresh_from_db()
        self.assertEqual(historical.status, "confirmed")

    def test_wrong_or_duplicate_mint_events_keep_the_original_hold_until_verified(self):
        self.node.event_changes = {"to": "0x" + "aa" * 20}
        with self.assertRaises(IssuanceExecutionUnresolved):
            self.execute()
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.node.event_changes = {}
        original_events = self.node.events
        self.node.contract.events.Transfer.return_value.process_receipt.side_effect = (
            lambda mined, **kwargs: original_events(mined) * 2
        )
        with self.assertRaises(IssuanceExecutionUnresolved):
            self.execute()
        self.node.contract.events.Transfer.return_value.process_receipt.side_effect = original_events
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_wrong_original_receipt_sender_cannot_complete_from_matching_mint_event(self):
        original_send = self.node.send

        def wrong_sender(raw):
            tx_hash = original_send(raw)
            self.node.receipts[tx_hash]["from"] = "0x" + "aa" * 20
            return tx_hash

        self.node.client.send_raw_transaction.side_effect = wrong_sender
        with self.assertRaises(IssuanceExecutionUnresolved):
            self.execute()
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        command = ShareIssuanceExecution.objects.get()
        self.node.receipts[command.transaction.tx_hash]["from"] = command.intent["sender"]
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_rpc_never_holds_public_private_or_signer_rows_on_another_connection(self):
        from django.db import connections

        from shared.db import current_alias
        from tokens.models import ShareToken

        command = admit(self.request, self.actor)
        current = connections[current_alias()]
        probe = current.copy(alias="issuance-rpc-probe")
        self.addCleanup(probe.close)
        with atomic():
            ShareIssuanceRequest.objects.select_for_update().get(pk=self.request.pk)
            with self.assertRaises(DatabaseError):
                with probe.cursor() as cursor:
                    cursor.execute("SELECT uuid FROM tokens_shareissuancerequest FOR UPDATE NOWAIT")
        seen = []

        def checked(name, callback):
            def call(*args, **kwargs):
                self.assertTrue(current.get_autocommit())
                self.assertFalse(current.in_atomic_block)
                probe.set_autocommit(False)
                try:
                    with probe.cursor() as cursor:
                        for model in (ShareIssuanceRequest, ShareIssuanceExecution, ShareToken, SigningAccount):
                            cursor.execute(f"SELECT uuid FROM {model._meta.db_table} FOR UPDATE NOWAIT")
                            self.assertTrue(cursor.fetchall(), model._meta.label)
                        for model in (ShareIssuance, OutgoingOperation):
                            cursor.execute(f"SELECT uuid FROM {model._meta.db_table} FOR UPDATE NOWAIT")
                            if name != "preflight":
                                self.assertTrue(cursor.fetchall(), model._meta.label)
                finally:
                    probe.rollback()
                    probe.set_autocommit(True)
                seen.append(name)
                return callback(*args, **kwargs)

            return call

        self.node.contract.functions.authorizedShares.return_value.call.side_effect = checked("preflight", lambda: 1000)
        self.node.client.send_raw_transaction.side_effect = checked("send", self.node.send)
        self.node.client.get_transaction_receipt.side_effect = checked("receipt", self.node.receipts.get)
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        self.assertEqual(set(seen), {"preflight", "send", "receipt"})

    def test_concurrent_capital_and_issuance_share_one_signer_without_reusing_a_nonce(self):
        import threading

        from django.db import connections

        from tokens.services import capital_execution
        from tokens.tests.capital_fixtures import CapitalNode
        from tokens.tests.capital_fixtures import admit as admit_capital
        from tokens.tests.capital_fixtures import capital_request

        capital_tenant, capital_actor = capital_request("concurrent-capital")
        capital_node = CapitalNode()
        capital = admit_capital(capital_tenant.capital_increase, capital_actor)
        issuance = admit(self.request, self.actor)
        ready = threading.Barrier(2)
        outcomes = {}

        def simultaneous_preparation(*args, **kwargs):
            ready.wait(15)
            return 60000

        self.node.client.estimate_gas.side_effect = simultaneous_preparation
        capital_node.client.estimate_gas.side_effect = simultaneous_preparation

        def worker(name, service, identity):
            try:
                outcomes[name] = service.recover(identity)["status"]
            except BaseException as exc:
                outcomes[name] = exc
            finally:
                connections.close_all()

        with patch("tokens.services.capital_execution.get_base_chain_client", return_value=capital_node.client):
            threads = [
                threading.Thread(target=worker, args=("issuance", issuance_execution, issuance.pk), daemon=True),
                threading.Thread(target=worker, args=("capital", capital_execution, capital.pk), daemon=True),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(30)
        self.assertFalse(any(thread.is_alive() for thread in threads), outcomes)
        self.assertEqual(outcomes, {"issuance": "executed", "capital": "executed"})
        self.assertEqual(list(SignedAttempt.objects.order_by("nonce").values_list("nonce", flat=True)), [7, 8])
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(len(capital_node.broadcasts), 1)

    def test_completed_retry_response_cannot_pair_success_with_a_stale_reverted_hash(self):
        self.node.receipt_status = 0
        self.assertEqual(self.execute()["status"], "failed")
        stale = ShareIssuanceExecution.objects.select_related("transaction").get()
        failed_hash = stale.transaction.tx_hash
        confirmed = issuance_execution.confirmation(self.request, self.actor)
        self.node.receipt_status = 1
        winner = self.execute(confirmed=confirmed)
        self.assertEqual(winner["status"], "executed")
        self.assertNotEqual(winner["tx_hash"], failed_hash)
        self.assertEqual(issuance_execution._result(stale), winner)
        self.assertEqual(BlockchainTransaction.objects.get(tx_hash=winner["tx_hash"]).status, "confirmed")
