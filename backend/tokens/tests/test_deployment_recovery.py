from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from assets.models import AssetChainDeployment
from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.services.transaction import TransactionMonitorService
from blockchain.tests.outgoing_fixtures import receipt
from shared.db import atomic
from tokens.exceptions import InvalidTokenStateException, TokenDeploymentFailedException
from tokens.models import ShareToken, TokenDeployment
from tokens.services import deployment
from tokens.tasks import check_pending_token_deployments, deploy_share_token_task
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    DeploymentNode,
    admitted_signer,
    deployment_token,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class DeploymentRecoveryTest(TransactionTestCase):
    def setUp(self):
        self.tenant = deployment_token()
        self.token = self.tenant.token
        self.node = DeploymentNode()
        for target in (
            "tokens.services.deployment.get_base_chain_client",
            "tokens.services.share_token_service.get_base_chain_client",
        ):
            patcher = patch(target, return_value=self.node.client)
            patcher.start()
            self.addCleanup(patcher.stop)
        admitted_signer()

    def execute(self, **options):
        return deployment.deploy_token(self.token, **options)

    def test_success_is_attributed_to_its_original_receipt_and_bridges_once(self):
        result = self.execute()
        self.assertEqual(result["contract_address"], CREATED)
        self.assertFalse(result["adopted"])
        self.assertEqual((self.token.status, self.token.chain), ("deployed", "base"))
        self.assertEqual(self.token.deployment_tx_hash, SignedAttempt.objects.get().tx_hash)
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertEqual(AssetChainDeployment.objects.filter(contract_address=CREATED).count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(TokenDeployment.objects.get().approval_outcome, "not_configured")
        self.node.client.send_transaction.assert_not_called()

    def test_unknown_send_recovers_exact_bytes_without_another_nonce(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.assertIsNone(self.execute()["contract_address"])
        original = SignedAttempt.objects.get()
        self.assertEqual(self.token.status, "deploying")
        self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.assertEqual(self.node.broadcasts, [bytes(original.raw_transaction)] * 2)
        self.assertEqual(SigningAccount.objects.get().next_nonce, original.nonce + 1)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.node.receipts[original.tx_hash] = receipt(original)
        self.node.existing_address = CREATED
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertEqual(len(self.node.broadcasts), 2)

    def test_lost_send_acknowledgement_can_complete_from_the_original_receipt(self):
        self.node.lose_acknowledgement = True
        self.assertEqual(self.execute()["contract_address"], CREATED)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_existing_contract_without_an_admitted_transaction_stays_pending(self):
        self.node.existing_address = CREATED
        with self.assertRaisesMessage(InvalidTokenStateException, "attribution"):
            self.execute()
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deploying")
        self.assertIsNone(self.token.contract_address)
        self.assertTrue(TokenDeployment.objects.get().attribution_required)
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(TokenDeployment.objects.get().approval_outcome, "")

    def test_matching_or_changed_cap_does_not_turn_identifier_lookup_into_attribution(self):
        self.node.existing_address = CREATED
        for cap in (int(self.token.total_supply), int(self.token.total_supply) + 1):
            with self.subTest(cap=cap):
                self.node.contract.functions.authorizedShares.return_value.call.return_value = cap
                with self.assertRaises(InvalidTokenStateException):
                    self.execute()
                self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.node.contract.functions.authorizedShares.assert_not_called()
        self.assertFalse(AssetChainDeployment.objects.filter(contract_address=CREATED).exists())

    def test_old_hashless_deploying_rows_cannot_gain_new_authority(self):
        old = self.tenant.company.tokens.create(name="Historical", symbol="OLD", total_supply="100", status="deploying")
        with self.assertRaisesMessage(InvalidTokenStateException, "attribution"):
            deployment.deploy_token(old)
        with self.assertRaises(DatabaseError), atomic():
            ShareToken.objects.filter(pk=old.pk).update(deployment_id=uuid4())
        self.assertFalse(TokenDeployment.objects.exists())
        self.node.client.assert_expected_chain.assert_not_called()

    def test_receipt_must_match_identifier_symbol_cap_and_factory(self):
        self.node.events_missing = True
        with self.assertRaises(InvalidTokenStateException):
            self.execute()
        self.node.events_missing = False
        for changes in ({"identifier": "foreign"}, {"symbol": "OTHER"}, {"authorizedShares": 999999}):
            self.node.event_changes = changes
            self.assertIsNone(deployment.recover(self.token.deployment_id))
            self.token.refresh_from_db()
            self.assertIsNone(self.token.contract_address)
        self.node.event_changes = {}
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_factory_lookup_does_not_finish_a_signed_transaction_without_its_receipt(self):
        self.node.confirmed = False
        self.execute()
        self.node.existing_address = CREATED
        self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.token.refresh_from_db()
        self.assertIsNone(self.token.contract_address)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_unsigned_preparation_failure_requires_an_explicit_fenced_retry(self):
        self.node.client.estimate_gas.side_effect = RuntimeError("synthetic gas failure")
        with self.assertRaises(TokenDeploymentFailedException):
            self.execute()
        failed_claim = OutgoingOperation.objects.get().claim_id
        self.node.client.estimate_gas.side_effect = None
        self.execute()
        self.assertEqual(self.node.broadcasts, [])
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.execute(retry_of=str(failed_claim))["contract_address"], CREATED)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_reverted_retry_retains_original_history_and_refuses_stale_claim_reopening(self):
        self.node.receipt_status = 0
        self.execute()
        first = SignedAttempt.objects.get()
        first_claim = OutgoingOperation.objects.get().claim_id
        self.execute(retry_of=str(first_claim))
        operation = OutgoingOperation.objects.get()
        second_claim = operation.claim_id
        self.assertNotEqual(first_claim, second_claim)
        self.assertEqual(BlockchainTransaction.objects.filter(status="reverted").count(), 2)
        self.execute(retry_of=str(first_claim))
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(OutgoingOperation.objects.get().claim_id, second_claim)
        self.node.receipt_status = 1
        self.execute(retry_of=str(second_claim))
        self.assertEqual(self.token.status, "deployed")
        self.assertEqual(SignedAttempt.objects.count(), 3)
        self.assertEqual(SignedAttempt.objects.get(pk=first.pk).tx_hash, first.tx_hash)

    def test_explicit_retry_recovers_the_revert_projection_after_a_worker_stop(self):
        self.node.receipt_status = 0
        with patch.object(deployment.deployment_journal, "record_outcome", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.execute()
        operation = OutgoingOperation.objects.get()
        original = SignedAttempt.objects.get()
        record = BlockchainTransaction.objects.get()
        self.assertEqual((operation.status, record.status), ("reverted", "submitted"))
        self.node.receipt_status = 1

        self.assertEqual(self.execute(retry_of=str(operation.claim_id))["contract_address"], CREATED)

        record.refresh_from_db()
        self.assertEqual(record.status, "reverted")
        self.assertEqual(record.tx_hash, original.tx_hash)
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(self.token.status, "deployed")

    def test_sweep_repairs_a_revert_without_authorizing_another_attempt(self):
        self.node.receipt_status = 0
        with patch.object(deployment.deployment_journal, "record_outcome", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                self.execute()
        original = SignedAttempt.objects.get()
        claim = OutgoingOperation.objects.get().claim_id
        nonce = SigningAccount.objects.get().next_nonce
        self.assertEqual(BlockchainTransaction.objects.get().status, "submitted")
        TokenDeployment.objects.update(updated_at=timezone.now() - timedelta(hours=1))

        with patch("tokens.services.deployment.get_base_chain_client") as provider:
            self.assertEqual(check_pending_token_deployments(), {"checked": 1, "resolved": 0})
        provider.assert_not_called()

        self.assertEqual(BlockchainTransaction.objects.get().status, "reverted")
        self.assertEqual(OutgoingOperation.objects.get().claim_id, claim)
        self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self.node.broadcasts, [bytes(original.raw_transaction)])
        TokenDeployment.objects.update(updated_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(check_pending_token_deployments(), {"checked": 0, "resolved": 0})

    def test_admission_closed_never_uses_legacy_sender(self):
        signer = SigningAccount.objects.get()
        outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=signer.address)
        with self.assertRaises(TokenDeploymentFailedException):
            self.execute()
        self.node.client.send_transaction.assert_not_called()
        self.assertEqual(self.node.broadcasts, [])

    def test_signed_receipt_can_complete_with_signer_admission_closed(self):
        self.node.confirmed = False
        self.execute()
        attempt = SignedAttempt.objects.get()
        outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=attempt.signer.address)
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        self.node.existing_address = CREATED
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_recovery_records_old_factory_outcome_without_projecting_into_current_configuration(self):
        self.node.confirmed = False
        self.execute()
        attempt = SignedAttempt.objects.get()
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        with override_settings(SHARE_TOKEN_FACTORY_ADDRESS="0x" + "1" * 40):
            self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.token.refresh_from_db()
        self.assertIsNone(self.token.contract_address)
        self.assertEqual(TokenDeployment.objects.get().contract_address, CREATED)
        self.assertEqual(BlockchainTransaction.objects.get().status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_deleted_or_retargeted_token_does_not_redirect_recovery(self):
        self.node.confirmed = False
        self.execute()
        attempt = SignedAttempt.objects.get()
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        original_id = self.token.pk
        self.token.delete()
        self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.assertFalse(ShareToken.objects.filter(pk=original_id).exists())
        self.assertEqual(TokenDeployment.objects.get().token_id, original_id)
        self.assertEqual(TokenDeployment.objects.get().contract_address, CREATED)

    def test_intent_and_operation_association_cannot_be_rewritten_or_deleted(self):
        self.node.confirmed = False
        self.execute()
        command = TokenDeployment.objects.get()
        for changes in (
            {"intent": command.intent | {"symbol": "OTHER"}},
            {"principal_id": 987654},
            {"operation": None},
            {"company_id": uuid4()},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                TokenDeployment.objects.filter(pk=command.pk).update(**changes)
        with self.assertRaises(DatabaseError), atomic():
            TokenDeployment.objects.filter(pk=command.pk).delete()

    def test_operator_sweep_visits_admitted_work_and_leaves_unattributed_history_alone(self):
        self.node.confirmed = False
        self.execute()
        self.tenant.company.tokens.create(name="Old", symbol="OLD", total_supply="10", status="deploying")
        self.assertEqual(check_pending_token_deployments(), {"checked": 0, "resolved": 0})
        attempt = SignedAttempt.objects.get()
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        self.node.existing_address = CREATED
        TokenDeployment.objects.update(updated_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(check_pending_token_deployments(), {"checked": 1, "resolved": 1})

    def test_task_checks_submission_before_any_provider_read(self):
        result = deploy_share_token_task(token_uuid=str(self.token.pk), deployment_id=str(uuid4()), principal_id=None)
        self.assertFalse(result["success"])
        self.node.client.assert_expected_chain.assert_not_called()
        result = deploy_share_token_task(
            token_uuid=str(self.token.pk), deployment_id=str(self.token.deployment_id), principal_id=None
        )
        self.assertTrue(result["success"])

    def test_duplicate_start_keeps_identity_and_the_current_outcome(self):
        identity = self.token.deployment_id
        with patch("tokens.tasks.deploy_share_token_task.defer") as queue:
            deployment.start_deployment(self.token, principal_id=self.tenant.user.pk)
        self.assertEqual(queue.call_args.kwargs["deployment_id"], str(identity))
        self.execute()
        with patch("tokens.tasks.deploy_share_token_task.defer") as queue:
            deployment.start_deployment(self.token, principal_id=self.tenant.user.pk)
        queue.assert_not_called()
        self.assertEqual(self.token.deployment_id, identity)

    def test_bridge_failure_remains_recoverable_after_the_token_contract_is_recorded(self):
        with patch(
            "tokens.services.share_token_service.verified_contract_asset",
            side_effect=RuntimeError("Synthetic bridge failure"),
        ):
            self.assertIsNone(self.execute()["contract_address"])
        self.assertEqual(
            (self.token.status, self.token.contract_address, self.token.chain), ("deployed", CREATED, "base")
        )
        self.assertIsNone(TokenDeployment.objects.get().projected_at)
        self.assertFalse(AssetChainDeployment.objects.filter(contract_address=CREATED).exists())
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertIsNotNone(TokenDeployment.objects.get().projected_at)
        self.assertTrue(AssetChainDeployment.objects.filter(contract_address=CREATED).exists())
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_legacy_monitor_leaves_the_new_projection_to_its_original_operation(self):
        self.node.confirmed = False
        self.execute()
        attempt = SignedAttempt.objects.get()
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        old = BlockchainTransaction.objects.create(
            tx_type="share_token_deploy",
            status="submitted",
            tx_hash="0x" + "ab" * 32,
            related_model="tokens.ShareToken",
            related_uuid=self.tenant.deployed_token.pk,
        )
        self.node.receipts[old.tx_hash] = receipt(attempt) | {"transactionHash": old.tx_hash}
        self.assertEqual(
            TransactionMonitorService.check_pending_transactions(self.node.client),
            {"checked": 1, "confirmed": 1, "failed": 0},
        )
        old.refresh_from_db()
        self.assertEqual(old.status, "confirmed")
        self.assertEqual(BlockchainTransaction.objects.get(pk=self.token.deployment_transaction_id).status, "submitted")
        self.node.existing_address = CREATED
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
