from unittest.mock import patch

from django.test import TransactionTestCase, override_settings

from blockchain.models import BlockchainTransaction, OutgoingOperation, SignedAttempt
from tokens.exceptions import IssuanceExecutionUnresolved
from tokens.models import ShareIssuance, ShareIssuanceRequest
from tokens.services import issuance_execution
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY, admit, install_issuance


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class IssuanceFinalityTest(TransactionTestCase):
    def setUp(self):
        install_issuance(self)
        self.command = admit(self.request, self.actor)

    def recover(self):
        return issuance_execution.recover(self.command.pk)

    def pending(self):
        self.node.finalized = 11
        self.assertEqual(self.recover()["status"], "executing")
        return SignedAttempt.objects.get()

    def test_first_receipt_cannot_complete_until_finalized(self):
        self.node.finalized = 11
        with patch("tokens.services.share_token_service.seed_recipient_holding") as seed:
            self.assertEqual(self.recover()["status"], "executing")
            seed.assert_not_called()
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertEqual(OutgoingOperation.objects.get().status, "confirmed")
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertIsNone(ShareIssuance.objects.get().completed_at)
        self.node.finalized = 12
        self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_first_revert_cannot_release_or_allow_retry_until_finalized(self):
        self.node.receipt_status = 0
        self.node.finalized = 11
        self.assertEqual(self.recover()["status"], "executing")
        admit(self.request, self.actor)
        self.assertEqual(self.recover()["status"], "executing")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.node.finalized = 12
        self.assertEqual(self.recover()["status"], "failed")
        self.assertEqual(BlockchainTransaction.objects.get().status, "reverted")

    def test_depth_policy_requires_every_confirmation(self):
        with self.settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 3}}):
            self.assertEqual(self.recover()["status"], "executing")
            self.node.head = 13
            self.assertEqual(self.recover()["status"], "executing")
            self.node.head = 14
            self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_unconfigured_or_invalid_policy_holds_the_original_attempt(self):
        for policies in ({}, {f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 0}}):
            with self.settings(WALLET_CHAIN_FINALITY_POLICIES=policies):
                self.assertEqual(self.recover()["status"], "executing")
        self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_unavailable_provider_holds_until_the_same_receipt_can_be_verified(self):
        self.pending()
        self.node.finalized = 12
        with patch.object(self.node.client.w3.eth, "get_block", side_effect=ConnectionError("Synthetic outage")):
            self.assertEqual(self.recover()["status"], "executing")
        self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_missing_receipt_cannot_complete_or_resend_after_first_inclusion(self):
        attempt = self.pending()
        receipt = self.node.receipts.pop(attempt.tx_hash)
        self.node.finalized = 12
        self.assertEqual(self.recover()["status"], "executing")
        self.node.receipts[attempt.tx_hash] = receipt
        self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_changed_head_holds_until_a_stable_observation(self):
        self.pending()
        self.node.finalized = 12

        def advancing(identifier):
            result = self.node.block(identifier)
            if identifier == "latest":
                self.node.head += 1
            return result

        with patch.object(self.node.client.w3.eth, "get_block", side_effect=advancing):
            self.assertEqual(self.recover()["status"], "executing")
        self.assertEqual(self.recover()["status"], "executed")

    def test_orphaned_receipt_holds_then_same_outcome_reinclusion_projects_its_final_block(self):
        attempt = self.pending()
        original_hash = self.node.block_hashes[12]
        self.node.block_hashes[12] = "0x" + "ee" * 32
        self.node.head = self.node.finalized = 14
        self.assertEqual(self.recover()["status"], "executing")
        final_hash = "0x" + "cc" * 32
        self.node.block_hashes[14] = final_hash
        self.node.receipts[attempt.tx_hash].update(blockNumber=14, blockHash=final_hash, gasUsed=23000)
        result = self.recover()
        self.assertEqual((result["status"], result["block_number"], result["gas_used"]), ("executed", 14, 23000))
        record = BlockchainTransaction.objects.get()
        self.assertEqual((record.block_number, record.block_hash, record.gas_used), (14, final_hash, 23000))
        self.assertEqual(ShareIssuance.objects.get().block_number, 14)
        operation = OutgoingOperation.objects.get()
        self.assertEqual((operation.block_number, operation.block_hash), (12, original_hash))
        with patch.object(issuance_execution, "get_base_chain_client", side_effect=AssertionError("Already complete")):
            self.assertEqual(self.recover(), result)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_changed_execution_outcome_stays_held_for_attribution(self):
        attempt = self.pending()
        self.node.block_hashes[12] = "0x" + "ee" * 32
        self.node.block_hashes[14] = "0x" + "cc" * 32
        self.node.head = self.node.finalized = 14
        self.node.receipts[attempt.tx_hash].update(blockNumber=14, blockHash=self.node.block_hashes[14], status=0)
        self.assertEqual(self.recover()["status"], "executing")
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertIsNone(ShareIssuance.objects.get().completed_at)
        self.node.receipts[attempt.tx_hash]["status"] = 1
        self.assertEqual(self.recover()["status"], "executed")

    def test_receipt_change_after_finality_collection_cannot_project(self):
        attempt = self.pending()
        self.node.finalized = 12
        original = issuance_execution.collect_chain_evidence

        def changed(*args, **kwargs):
            verdict = original(*args, **kwargs)
            self.node.receipts[attempt.tx_hash]["blockHash"] = "0x" + "cc" * 32
            return verdict

        with patch.object(issuance_execution, "collect_chain_evidence", side_effect=changed):
            with self.assertRaises(IssuanceExecutionUnresolved):
                self.recover()
        self.assertIsNone(ShareIssuance.objects.get().completed_at)
        self.node.receipts[attempt.tx_hash]["blockHash"] = self.node.block_hashes[12]
        self.assertEqual(self.recover()["status"], "executed")

    def test_policy_change_before_locked_projection_cannot_complete(self):
        original = issuance_execution._project

        def changed(*args, **kwargs):
            with self.settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 9}}):
                return original(*args, **kwargs)

        with patch.object(issuance_execution, "_project", side_effect=changed):
            with self.assertRaises(IssuanceExecutionUnresolved):
                self.recover()
        self.assertIsNone(ShareIssuance.objects.get().completed_at)
        self.assertEqual(self.recover()["status"], "executed")

    def test_completion_failure_rolls_back_both_public_and_private_statuses(self):
        original = ShareIssuanceRequest.mark_executed

        def interrupted(request, issuance):
            original(request, issuance)
            raise RuntimeError("Synthetic completion interruption")

        with patch.object(ShareIssuanceRequest, "mark_executed", interrupted):
            with self.assertRaises(RuntimeError):
                self.recover()
        self.command.refresh_from_db()
        self.request.refresh_from_db()
        self.assertEqual(
            (self.command.status, self.request.status, ShareIssuance.objects.get().status),
            ("executing", "executing", "processing"),
        )
        self.assertIsNone(self.request.executed_at)
        self.assertIsNone(ShareIssuance.objects.get().completed_at)
        self.assertEqual(self.recover()["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)
