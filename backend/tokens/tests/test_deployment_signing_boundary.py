from unittest.mock import patch

from django.db import connections
from django.test import TransactionTestCase, override_settings
from web3 import Web3

from blockchain.models import BlockchainTransaction, SignedAttempt, SigningAccount
from shared.db import atomic, current_alias, use_operator
from tokens.exceptions import InvalidTokenStateException, TokenDeploymentFailedException
from tokens.models import ShareToken, TokenDeployment
from tokens.services import deployment, deployment_journal
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    install_deployment,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class DeploymentSigningBoundaryTest(TransactionTestCase):
    def setUp(self):
        install_deployment(self)

    def execute(self):
        return deployment.deploy_token(self.token)

    def test_broadcast_observes_committed_bytes_hash_and_token_association_without_an_outer_transaction(self):
        observations = []
        send = self.node.send

        def observe(raw):
            connection = connections[current_alias()]
            observer = connection.copy(alias="deployment_observer")
            try:
                with observer.cursor() as cursor:
                    cursor.execute(
                        "SELECT t.deployment_tx_hash, t.deployment_transaction_id, b.tx_hash, a.raw_transaction "
                        "FROM tokens_sharetoken t JOIN tokens_tokendeployment d ON d.uuid=t.deployment_id "
                        "JOIN blockchain_outgoingoperation o ON d.operation_id=o.uuid "
                        "JOIN blockchain_signedattempt a ON o.current_attempt_id=a.uuid "
                        "JOIN blockchain_blockchaintransaction b ON t.deployment_transaction_id=b.uuid "
                        "WHERE t.uuid=%s",
                        [self.token.pk],
                    )
                    observations.append(cursor.fetchone())
            finally:
                observer.close()
            self.assertTrue(connection.get_autocommit())
            self.assertFalse(connection.in_atomic_block)
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        self.assertEqual(self.execute()["contract_address"], CREATED)
        attempt = SignedAttempt.objects.get()
        record = BlockchainTransaction.objects.get()
        self.assertEqual(len(observations), 1)
        tx_hash, record_id, projected_hash, raw = observations[0]
        self.assertEqual(
            (tx_hash, record_id, projected_hash, bytes(raw)),
            (attempt.tx_hash, record.pk, attempt.tx_hash, bytes(attempt.raw_transaction)),
        )

    def test_callback_failure_rolls_back_signed_bytes_nonce_record_and_public_association(self):
        record_signed = deployment_journal.record_signed_deployment
        nonce = SigningAccount.objects.get().next_nonce

        def save_then_fail(*args):
            record_signed(*args)
            raise RuntimeError("Synthetic database interruption")

        with patch.object(deployment_journal, "record_signed_deployment", side_effect=save_then_fail):
            with self.assertRaises(TokenDeploymentFailedException):
                self.execute()
        self.token.refresh_from_db()
        self.assertIsNone(self.token.deployment_tx_hash)
        self.assertIsNone(TokenDeployment.objects.get().transaction_id)
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertFalse(BlockchainTransaction.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(self.execute()["contract_address"], CREATED)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_partial_public_binding_rolls_back_before_any_broadcast(self):
        bind = ShareToken.bind_deployment_transaction

        def bind_then_fail(token, tx_hash, record, **kwargs):
            self.assertTrue(bind(token, tx_hash, record, **kwargs))
            raise RuntimeError("Synthetic public association interruption")

        with patch.object(ShareToken, "bind_deployment_transaction", bind_then_fail):
            with self.assertRaises(TokenDeploymentFailedException):
                self.execute()
        self.token.refresh_from_db()
        self.assertIsNone(self.token.deployment_transaction_id)
        self.assertFalse(BlockchainTransaction.objects.exists())
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_lost_signing_commit_acknowledgement_recovers_the_original_bytes(self):
        with use_operator():
            connection = connections[current_alias()]
        commit = connection.commit
        lost = []

        def commit_then_lose_acknowledgement():
            signed = SignedAttempt.objects.exists()
            commit()
            if signed and not lost:
                lost.append(True)
                raise RuntimeError("Synthetic commit acknowledgement loss")

        with patch.object(connection, "commit", side_effect=commit_then_lose_acknowledgement):
            with self.assertRaises(TokenDeploymentFailedException):
                self.execute()
        self.assertEqual(lost, [True])
        self.assertEqual(self.node.broadcasts, [])
        attempt = SignedAttempt.objects.get()
        self.token.refresh_from_db()
        self.assertEqual(self.token.deployment_tx_hash, attempt.tx_hash)
        self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_outer_transaction_refused_before_admission_or_provider_reads(self):
        with atomic():
            with self.assertRaisesMessage(InvalidTokenStateException, "autocommit"):
                self.execute()
        self.assertFalse(TokenDeployment.objects.exists())
        self.node.client.assert_expected_chain.assert_not_called()

    def test_manual_autocommit_off_refused_before_admission(self):
        connection = connections[current_alias()]
        connection.set_autocommit(False)
        try:
            with self.assertRaisesMessage(InvalidTokenStateException, "autocommit"):
                self.execute()
        finally:
            connection.rollback()
            connection.set_autocommit(True)
        self.assertFalse(TokenDeployment.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_provider_hash_mismatch_does_not_replace_the_signed_identity(self):
        self.node.confirmed = False
        self.node.client.send_raw_transaction.return_value = "0x" + "ab" * 32
        self.node.client.send_raw_transaction.side_effect = None
        self.assertIsNone(self.execute()["contract_address"])
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.token.deployment_tx_hash, Web3.to_hex(Web3.keccak(bytes(attempt.raw_transaction))))
        self.assertNotEqual(self.token.deployment_tx_hash, "0x" + "ab" * 32)
        self.assertEqual(attempt.operation.status, "signed")
        self.node.client.send_raw_transaction.side_effect = self.node.send
        deployment.recover(self.token.deployment_id)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])

    def test_configuration_changed_during_preparation_cannot_change_the_signed_terms(self):
        original = self.node.client.estimate_gas.return_value

        def edit_token(transaction):
            ShareToken.objects.filter(pk=self.token.pk).update(total_supply="9999")
            return original

        self.node.client.estimate_gas.side_effect = edit_token
        with self.assertRaises(InvalidTokenStateException):
            self.execute()
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])
        self.assertNotEqual(TokenDeployment.objects.get().intent["authorized_shares"], "9999")

    def test_queue_failure_rolls_back_the_first_submission_and_status(self):
        token = self.tenant.company.tokens.create(name="Queue failure", symbol="QUE", total_supply="100")
        with patch("tokens.tasks.deploy_share_token_task.defer", side_effect=RuntimeError("Synthetic queue failure")):
            with self.assertRaises(RuntimeError):
                deployment.start_deployment(token, principal_id=self.tenant.user.pk)
        token.refresh_from_db()
        self.assertEqual(token.status, "draft")
        self.assertIsNone(token.deployment_id)
