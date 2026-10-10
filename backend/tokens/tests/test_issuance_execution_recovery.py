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
        self.assertEqual(result["tx_hash"], self.attempts.get().tx_hash)
        self.assertEqual(self.transactions.get().status, "confirmed")
        self.assertEqual(ShareIssuance.objects.get().amount, str(self.request.amount))
        self.assertEqual(self.execute(), result)
        from tokens.models import RegisterEntry, RegisterPosition, ShareRegister

        issuance = ShareIssuance.objects.get()
        self.assertEqual(RegisterEntry.objects.filter(operation_id=issuance.pk, kind="issue").count(), 1)
        self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, self.request.amount)
        self.assertEqual(
            RegisterPosition.objects.get(register__token=self.token, member_id=self.company_issue.member).shares,
            self.request.amount,
        )
        self.assertEqual(len(self.node.broadcasts), 1)
        self.node.client.send_transaction.assert_not_called()

    def test_unknown_send_replays_original_bytes_without_another_nonce(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.assertEqual(self.execute()["status"], "executing")
        attempt = self.attempts.get()
        self.assertEqual(self.execute()["status"], "executing")
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
        self.assertEqual(self.attempts.count(), 1)
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
        self.assertEqual(self.transactions.get().status, "confirmed")
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
        self.assertEqual(self.attempts.count(), 1)
        self.assertEqual(self.execute(confirmed=failed)["status"], "failed")
        self.assertEqual(self.attempts.count(), 2)
        self.assertEqual(self.execute(confirmed=failed)["status"], "failed")
        self.assertEqual(self.attempts.count(), 2)
        latest = issuance_execution.confirmation(self.request, self.actor)
        self.node.receipt_status = 1
        self.assertEqual(self.execute(confirmed=latest)["status"], "executed")
        self.assertEqual(
            list(self.transactions.order_by("created_at").values_list("status", flat=True)),
            ["reverted", "reverted", "confirmed"],
        )

    def test_paused_company_preflight_holds_original_unsigned_claim_until_ready(self):
        self.node.contract.functions.paused.return_value.call.return_value = True
        self.assertEqual(self.execute()["status"], "executing")
        self.assertFalse(self.attempts.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, self.initial_nonce)
        operation = self.operations.get()
        self.assertEqual(operation.status, "preparing")
        self.node.contract.functions.paused.return_value.call.return_value = False
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(self.operations.get().claim_id, operation.claim_id)
        self.assertEqual(self.attempts.count(), 1)

    def test_admission_and_queue_rollback_together(self):
        with patch.object(issuance_execution, "_enqueue", side_effect=RuntimeError("queue failed")):
            with self.assertRaises(RuntimeError):
                admit(self.request, self.actor)
        self.assertFalse(ShareIssuanceExecution.objects.exists())
        self.assertFalse(ShareIssuance.objects.exists())
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "under_review")

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
        self.assertFalse(self.operations.exists())

    def test_lost_signed_commit_acknowledgement_recovers_original_attempt(self):
        from blockchain.services import outgoing

        original = outgoing.sign_operation

        def committed_then_lost(*args, **kwargs):
            original(*args, **kwargs)
            raise ConnectionError("Synthetic commit acknowledgement loss")

        with patch.object(outgoing, "sign_operation", side_effect=committed_then_lost):
            self.assertEqual(self.execute()["status"], "executing")
        attempt = self.attempts.get()
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(self.attempts.get().pk, attempt.pk)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])
        self.assertEqual(self.attempts.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_signed_callback_rollback_cannot_consume_nonce_or_broadcast(self):
        original = issuance_execution._record_signed

        def rolled_back(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("Synthetic callback rollback")

        with patch.object(issuance_execution, "_record_signed", side_effect=rolled_back):
            self.assertEqual(self.execute()["status"], "executing")
        self.assertFalse(self.attempts.exists())
        self.assertFalse(self.transactions.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, self.initial_nonce)
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

    def test_current_unsigned_claim_recovers_its_original_admitted_execution(self):
        command = admit(self.request, self.actor)
        issuance_execution._start(command)
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

    def test_whitelist_and_headroom_holds_keep_original_unsigned_claim(self):
        command = admit(self.request, self.actor)
        with patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=False):
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        operation = self.operations.get()
        self.assertEqual(operation.status, "preparing")
        self.node.contract.functions.authorizedShares.return_value.call.return_value = self.request.amount - 1
        self.assertEqual(self.execute()["status"], "executing")
        self.assertFalse(self.attempts.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, self.initial_nonce)
        self.node.contract.functions.authorizedShares.return_value.call.return_value = self.request.amount
        self.assertEqual(self.execute()["status"], "executed")
        self.assertEqual(self.operations.get().claim_id, operation.claim_id)

    def test_provider_error_cannot_publish_the_private_signed_payload(self):
        from web3 import Web3

        from tokens.serializers.share_issuance_request import (
            ShareIssuanceRequestSerializer,
        )

        def failed_send(raw):
            raise ConnectionError(Web3.to_hex(raw))

        self.node.client.send_raw_transaction.side_effect = failed_send
        self.assertEqual(self.execute()["status"], "executing")
        self.assertEqual(self.operations.get().last_error, "ConnectionError")
        raw = Web3.to_hex(self.attempts.get().raw_transaction)
        self.request.refresh_from_db()
        self.assertNotIn(raw, str(ShareIssuanceRequestSerializer(self.request).data))
        self.assertIsNone(ShareIssuance.objects.get().mint_journal)

    def test_generic_monitor_only_updates_historical_transactions(self):
        from unittest.mock import Mock

        from blockchain.services.transaction import check_pending_transactions

        self.node.confirmed = False
        self.assertEqual(self.execute()["status"], "executing")
        current = self.transactions.get()
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

        capital_tenant, capital_actor = capital_request(self)
        capital_node = CapitalNode()
        capital = admit_capital(capital_tenant.capital_increase, capital_actor)
        initial_nonce = SigningAccount.objects.get().next_nonce
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
        issuance.refresh_from_db()
        capital.refresh_from_db()
        self.assertEqual(
            list(
                SignedAttempt.objects.filter(operation_id__in=[issuance.operation_id, capital.operation_id])
                .order_by("nonce")
                .values_list("nonce", flat=True)
            ),
            [initial_nonce, initial_nonce + 1],
        )
        self.assertEqual(SigningAccount.objects.get().next_nonce, initial_nonce + 2)
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


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class RetainedIssuanceExecutionRecoveryTest(TransactionTestCase):
    def setUp(self):
        from tokens.tests.issuance_fixtures import (
            FINALITY_POLICIES,
            IssuanceNode,
            issuance_request,
        )

        self.enterContext(override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES))
        self.tenant, self.actor = issuance_request("retained-issuance", signed=True)
        self.request = self.tenant.issuance_request
        self.command = ShareIssuanceExecution.objects.get(request_id=self.request.pk)
        self.node = IssuanceNode()
        self.enterContext(
            patch("tokens.services.issuance_execution.get_base_chain_client", return_value=self.node.client)
        )
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))

    def test_null_company_source_recovers_original_signed_bytes_without_new_admission(self):
        self.assertIsNone(self.command.source_instruction_id)
        attempt = SignedAttempt.objects.get(operation_id=self.command.operation_id)
        original = (attempt.pk, attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce, attempt.claim_id)
        self.assertEqual(issuance_execution.recover(self.command.pk)["status"], "executed")
        current = SignedAttempt.objects.get(operation_id=self.command.operation_id)
        self.assertEqual(
            (current.pk, current.tx_hash, bytes(current.raw_transaction), current.nonce, current.claim_id), original
        )
        self.assertEqual(self.node.broadcasts, [original[2]])
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)

    def test_recovery_continues_original_signed_work_after_staff_actor_deletion(self):
        original_actor = self.actor.pk
        attempt = SignedAttempt.objects.get(operation_id=self.command.operation_id)
        self.actor.delete()
        self.assertEqual(issuance_execution.recover(self.command.pk)["status"], "executed")
        self.command.refresh_from_db()
        self.assertEqual(self.command.executed_by_id, original_actor)
        self.assertIsNone(ShareIssuance.objects.get().initiated_by_id)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])
        self.assertEqual(SignedAttempt.objects.count(), 1)
