from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied

from assets.models import AssetChainDeployment
from blockchain.models import (
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.services.transaction import check_pending_transactions
from blockchain.tests.outgoing_fixtures import receipt
from shared.db import atomic, current_alias
from tokens.exceptions import MintRequestConflict, MintRequestUnresolved
from tokens.models import MintRequest, MintRequestStatus
from tokens.services import mint_service
from tokens.tasks.mint_request import recover_mint_requests
from tokens.tests.mint_request_fixtures import (
    CHAIN_ID,
    KEY,
    MintNode,
    admitted_signer,
    mint_request,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class MintRequestRecoveryTest(TransactionTestCase):
    def setUp(self):
        self.actor = get_user_model().objects.create_superuser(email="mint@example.test", password="synthetic")
        self.request = mint_request(self.actor)
        self.node = MintNode()
        self.patcher = patch("tokens.services.mint_service.get_base_chain_client", return_value=self.node.client)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        admitted_signer()

    def execute(self, **options):
        return mint_service.execute(self.request, self.actor, **options)

    def test_repeated_execution_returns_one_original_mint_and_projection(self):
        first = self.execute()
        second = self.execute()
        self.assertEqual(first, second)
        self.assertEqual(self.request.status, MintRequestStatus.EXECUTED)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)
        self.node.client.send_transaction.assert_not_called()

    def test_unknown_send_recovers_the_exact_signed_bytes(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        tx_hash, record = self.execute()
        self.assertEqual(self.request.status, MintRequestStatus.EXECUTING)
        self.assertEqual(record.tx_hash, tx_hash)
        self.assertEqual(record.status, "submitted")
        self.assertEqual(mint_service.recover(self.request.pk), "executing")
        self.assertEqual(len(self.node.broadcasts), 2)
        self.assertEqual(self.node.broadcasts[0], self.node.broadcasts[1])
        self.assertEqual(SignedAttempt.objects.count(), 1)
        attempt = SignedAttempt.objects.get()
        self.node.receipts[tx_hash] = receipt(attempt)
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        self.assertEqual(len(self.node.broadcasts), 2)

    def test_receipt_after_lost_acknowledgement_completes_original_mint(self):
        self.node.lose_acknowledgement = True
        self.execute()
        self.assertEqual(self.request.status, "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_broadcast_observes_committed_request_operation_and_projection_without_a_transaction(self):
        send = self.node.send

        def observe(raw):
            self.assertTrue(connections[current_alias()].get_autocommit())
            current = MintRequest.objects.get(pk=self.request.pk)
            self.assertIsNotNone(current.execution_intent)
            self.assertEqual(current.operation.status, "signed")
            self.assertEqual(current.transaction.tx_hash, current.operation.current_attempt.tx_hash)
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        self.execute()
        self.assertEqual(self.request.status, "executed")

    def test_default_closed_admission_never_uses_the_legacy_sender(self):
        outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=SigningAccount.objects.get().address)
        with self.assertRaises(MintRequestUnresolved):
            self.execute()
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])
        self.node.client.send_transaction.assert_not_called()

    def test_existing_signed_operation_can_reconcile_while_admission_is_closed(self):
        self.node.confirmed = False
        tx_hash, _ = self.execute()
        outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=SignedAttempt.objects.get().signer.address)
        self.node.receipts[tx_hash] = receipt(SignedAttempt.objects.get())
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_reverted_mint_needs_an_explicit_current_attempt_retry(self):
        self.node.receipt_status = 0
        with self.assertRaises(MintRequestConflict):
            self.execute()
        self.request.refresh_from_db()
        claim = self.request.operation.claim_id
        with self.assertRaises(MintRequestConflict):
            self.execute()
        self.assertEqual(mint_service.recover(self.request.pk), "failed")
        self.assertEqual(len(self.node.broadcasts), 1)
        self.node.receipt_status = 1
        self.execute(retry_of=claim)
        self.assertEqual(self.request.status, "executed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(len(self.node.broadcasts), 2)

    def test_replayed_retry_form_cannot_restart_a_later_reverted_attempt(self):
        self.node.receipt_status = 0
        with self.assertRaises(MintRequestConflict):
            self.execute()
        original = OutgoingOperation.objects.get().claim_id
        with self.assertRaises(MintRequestConflict):
            self.execute(retry_of=original)
        with self.assertRaises(MintRequestConflict):
            self.execute(retry_of=original)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(len(self.node.broadcasts), 2)

    def interrupted_revert(self):
        project = mint_service._project
        self.node.receipt_status = 0

        def interrupt(request_id, claim):
            if OutgoingOperation.objects.get(pk=claim.operation_id).status == "reverted":
                raise SystemExit("Stopped before projecting the revert")
            return project(request_id, claim)

        with patch.object(mint_service, "_project", interrupt), self.assertRaises(SystemExit):
            self.execute()
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(self.request.transaction.status, "submitted")
        return self.request.transaction, self.request.operation

    def assert_retained_revert(self, record, operation):
        record.refresh_from_db()
        self.assertEqual(record.status, "reverted")
        self.assertEqual(record.block_number, operation.block_number)
        self.assertEqual(record.block_hash, operation.block_hash)
        self.assertEqual(record.gas_used, operation.gas_used)

    def test_retry_retains_the_previous_revert_before_preparing_another_attempt(self):
        previous, operation = self.interrupted_revert()
        prepare = outgoing.prepare_operation
        observed = []

        def prepare_after_retention(*args, **kwargs):
            self.assertTrue(connections[current_alias()].get_autocommit())
            self.assert_retained_revert(previous, operation)
            observed.append(previous.pk)
            return prepare(*args, **kwargs)

        self.node.receipt_status = 1
        with patch.object(outgoing, "prepare_operation", prepare_after_retention):
            self.execute(retry_of=operation.claim_id)
        self.assertEqual(observed, [previous.pk])
        self.assert_retained_revert(previous, operation)
        self.assertNotEqual(self.request.transaction_id, previous.pk)
        self.assertEqual(self.request.status, "executed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)

    def test_lost_revert_projection_acknowledgement_preserves_the_original_retry_claim(self):
        previous, operation = self.interrupted_revert()
        project = mint_service._project

        def lose_ack(*args, **kwargs):
            project(*args, **kwargs)
            raise ConnectionError("Lost committed revert projection acknowledgement")

        with patch.object(mint_service, "_project", lose_ack), self.assertRaises(MintRequestUnresolved):
            self.execute(retry_of=operation.claim_id)
        self.assert_retained_revert(previous, operation)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(OutgoingOperation.objects.get().claim_id, operation.claim_id)
        self.node.receipt_status = 1
        self.execute(retry_of=operation.claim_id)
        self.assertEqual(self.request.status, "executed")
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_stale_projection_loser_does_not_reopen_a_newer_reverted_attempt(self):
        previous, operation = self.interrupted_revert()
        project = mint_service._project
        advanced = []

        def competing_retry(request_id, claim):
            if not advanced:
                advanced.append(claim.claim_id)
                with patch.object(mint_service, "_project", project), self.assertRaises(MintRequestConflict):
                    self.execute(retry_of=operation.claim_id)
            return project(request_id, claim)

        with patch.object(mint_service, "_project", competing_retry), self.assertRaises(MintRequestConflict):
            self.execute(retry_of=operation.claim_id)
        self.assertEqual(advanced, [operation.claim_id])
        self.assert_retained_revert(previous, operation)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
        self.request.refresh_from_db()
        self.assertEqual(self.request.transaction.status, "reverted")
        self.assertNotEqual(self.request.operation.claim_id, operation.claim_id)

    def test_sweep_repairs_an_interrupted_revert_without_provider_access_or_retry(self):
        previous, operation = self.interrupted_revert()
        with patch.object(mint_service, "get_base_chain_client", side_effect=AssertionError("No provider needed")):
            self.assertEqual(recover_mint_requests.func(), {"failed": 1})
            self.assertEqual(recover_mint_requests.func(), {})
        self.assert_retained_revert(previous, operation)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_delayed_initial_admission_cannot_restart_a_reverted_operation(self):
        captured = mint_service._admit(self.request.pk, self.actor, "tokens.change_mintrequest", "")
        self.node.receipt_status = 0
        with self.assertRaises(MintRequestConflict):
            self.execute()
        mint_service._process(captured)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_recovery_finishes_an_admitted_request_after_its_actor_loses_staff_access(self):
        mint_service._admit(self.request.pk, self.actor, "tokens.change_mintrequest", "")
        get_user_model().objects.filter(pk=self.actor.pk).update(is_staff=False)
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        self.request.refresh_from_db()
        self.assertEqual(self.request.executed_by_id, self.actor.pk)

    def test_fresh_execution_rechecks_staff_permission_before_admission(self):
        get_user_model().objects.filter(pk=self.actor.pk).update(is_staff=False)
        with self.assertRaises(PermissionDenied):
            self.execute()
        self.request.refresh_from_db()
        self.assertIsNone(self.request.execution_intent)
        self.assertFalse(OutgoingOperation.objects.exists())

    def test_wrong_source_permission_cannot_admit_another_token_kind(self):
        with self.assertRaises(PermissionDenied):
            self.execute(permission="tokens.change_yieldtoken")
        self.request.refresh_from_db()
        self.assertIsNone(self.request.execution_intent)

    def test_an_enclosing_transaction_is_refused_before_admission(self):
        with atomic():
            with self.assertRaises(MintRequestConflict):
                self.execute()
        self.assertFalse(OutgoingOperation.objects.exists())

    def test_unadmitted_and_rejected_requests_are_not_recovered(self):
        self.assertEqual(mint_service.recover(self.request.pk), "not_admitted")
        mint_service.reject(self.request, self.actor, "Duplicate")
        self.assertEqual(mint_service.recover(self.request.pk), "not_admitted")
        with self.assertRaises(MintRequestConflict):
            self.execute()
        self.assertEqual(self.node.broadcasts, [])

    def test_admitted_request_cannot_be_rejected_or_mutated(self):
        self.node.confirmed = False
        self.execute()
        with self.assertRaises(MintRequestConflict):
            mint_service.reject(self.request, self.actor, "Too late")
        for changes in (
            {"amount": 1},
            {"recipient_address": "0x" + "b" * 40},
            {"dispatch_id": uuid4()},
            {"execution_intent": None},
            {"status": "failed"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                MintRequest.objects.filter(pk=self.request.pk).update(**changes)

    def test_configuration_drift_before_signing_is_refused(self):
        mint_service._admit(self.request.pk, self.actor, "tokens.change_mintrequest", "")
        AssetChainDeployment.objects.filter(asset=self.request.settlement_asset).update(
            contract_address="0x" + "c" * 40
        )
        self.assertEqual(mint_service.recover(self.request.pk), "unresolved")
        self.assertFalse(SignedAttempt.objects.exists())

    def test_captured_signed_recovery_survives_later_deployment_changes(self):
        self.node.confirmed = False
        tx_hash, _ = self.execute()
        AssetChainDeployment.objects.filter(asset=self.request.settlement_asset).update(
            contract_address="0x" + "c" * 40
        )
        self.node.receipts[tx_hash] = receipt(SignedAttempt.objects.get())
        self.assertEqual(mint_service.recover(self.request.pk), "executed")

    def test_wrong_receipt_identity_remains_unresolved(self):
        self.node.confirmed = False
        tx_hash, _ = self.execute()
        bad = receipt(SignedAttempt.objects.get())
        bad["transactionHash"] = "0x" + "f" * 64
        self.node.receipts[tx_hash] = bad
        self.assertEqual(mint_service.recover(self.request.pk), "unresolved")
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_generic_monitor_does_not_write_the_converted_mint_projection(self):
        self.node.confirmed = False
        tx_hash, _ = self.execute()
        self.node.receipts[tx_hash] = receipt(SignedAttempt.objects.get())
        result = check_pending_transactions(self.node.client)
        self.assertEqual(result, {"checked": 0, "confirmed": 0, "failed": 0})
        self.request.transaction.refresh_from_db()
        self.assertEqual(self.request.transaction.status, "submitted")
        self.assertEqual(mint_service.recover(self.request.pk), "executed")

    def test_lost_operation_binding_acknowledgement_recovers_one_operation(self):
        original = MintRequest.save
        answered = False

        def lose_ack(request, *args, **kwargs):
            nonlocal answered
            result = original(request, *args, **kwargs)
            if not answered and kwargs.get("update_fields") == ["operation", "status", "updated_at"]:
                answered = True
                connections[current_alias()].on_commit(lambda: (_ for _ in ()).throw(ConnectionError("lost ack")))
            return result

        with patch.object(MintRequest, "save", lose_ack), self.assertRaises(MintRequestUnresolved):
            self.execute()
        self.assertTrue(answered)
        self.assertEqual(OutgoingOperation.objects.count(), 1)
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_lost_signed_commit_acknowledgement_does_not_allocate_a_new_nonce(self):
        sign = outgoing.sign_operation

        def lose_ack(*args, **kwargs):
            sign(*args, **kwargs)
            raise ConnectionError("lost committed signing acknowledgement")

        with patch.object(outgoing, "sign_operation", lose_ack), self.assertRaises(MintRequestUnresolved):
            self.execute()
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_periodic_recovery_does_not_start_pending_requests_or_retry_a_revert(self):
        self.assertEqual(recover_mint_requests.func(), {})
        self.node.receipt_status = 0
        with self.assertRaises(MintRequestConflict):
            self.execute()
        self.assertEqual(recover_mint_requests.func(), {})
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_new_deliberate_submissions_are_distinct_but_same_id_changed_terms_are_refused(self):
        values = {field: getattr(self.request, field) for field in mint_service.REQUEST_FIELDS}
        submission_id = uuid4()
        first = mint_service.create_request(
            submission_id, self.actor, settlement_asset=self.request.settlement_asset, **values
        )
        same = mint_service.create_request(
            submission_id, self.actor, settlement_asset=self.request.settlement_asset, **values
        )
        second = mint_service.create_request(
            uuid4(), self.actor, settlement_asset=self.request.settlement_asset, **values
        )
        self.assertEqual(first.pk, same.pk)
        self.assertNotEqual(first.pk, second.pk)
        with self.assertRaises(MintRequestConflict):
            mint_service.create_request(
                submission_id, self.actor, settlement_asset=self.request.settlement_asset, **(values | {"amount": 2})
            )

    def test_operation_cannot_be_rebound_to_unrelated_intent(self):
        self.node.confirmed = False
        self.execute()
        other = outgoing.open_operation(
            "different-work",
            chain_id=CHAIN_ID,
            sender=self.request.operation.intent["sender"],
            to=self.request.operation.intent["to"],
        )
        with self.assertRaises(DatabaseError), atomic():
            MintRequest.objects.filter(pk=self.request.pk).update(operation_id=other.operation_id)
        changed = deepcopy(self.request.execution_intent)
        changed["data"] = "0x"
        with self.assertRaises(DatabaseError), atomic():
            MintRequest.objects.filter(pk=self.request.pk).update(execution_intent=changed)

    def test_historical_requests_are_never_automatically_adopted(self):
        legacy = MintRequest.objects.create(
            dispatch_id=None,
            settlement_asset=self.request.settlement_asset,
            requested_by=self.actor,
            recipient_address=self.request.recipient_address,
            amount=1,
            recipient_name="Legacy",
            deposit_reference="OLD",
            deposit_date=self.request.deposit_date,
            status="failed",
        )
        with self.assertRaises(MintRequestConflict):
            mint_service.execute(legacy, self.actor)
        self.assertEqual(mint_service.recover(legacy.pk), "not_admitted")
        with self.assertRaises(DatabaseError), atomic():
            MintRequest.objects.filter(pk=legacy.pk).update(dispatch_id=uuid4())
