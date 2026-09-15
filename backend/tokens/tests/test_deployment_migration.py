from unittest.mock import patch

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken, TokenDeployment
from tokens.services import deployment
from tokens.tests.deployment_fixtures import CHAIN_ID, FACTORY, KEY, deployment_token


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class DeploymentMigrationTest(TransactionTestCase):
    def test_upgrade_retains_historical_terms_hashes_and_null_submission_identity(self):
        tenant = make_tenant("historical-deployment")
        self.addCleanup(restore_every_migration)
        before = migrate_to([("tokens", "0042_mint_request_operations")])
        tokens = before.get_model("tokens", "ShareToken").objects
        transactions = before.get_model("blockchain", "BlockchainTransaction").objects
        saved = []
        for index, status in enumerate(("draft", "deploying", "deployed", "paused")):
            record = transactions.create(
                tx_hash="0x" + str(index + 1) * 64, tx_type="share_token_deploy", status="submitted"
            )
            old = tokens.get(pk=tenant.token.pk)
            old.pk = None
            old.symbol = f"OLD{index}"
            old.status = status
            old.deployment_transaction_id = record.pk
            old.deployment_tx_hash = record.tx_hash
            old.save()
            saved.append(tokens.filter(pk=old.pk).values().get())
        after = migrate_to([("tokens", "0044_token_deployment_guards")])
        for original in saved:
            current = after.get_model("tokens", "ShareToken").objects.filter(pk=original["uuid"]).values().get()
            self.assertIsNone(current.pop("deployment_id"))
            self.assertEqual(current, original)
        old_binary = tokens.get(pk=tenant.token.pk)
        old_binary.pk = None
        old_binary.symbol = "BINARY"
        old_binary.save()
        restore_every_migration()
        self.assertIsNone(ShareToken.objects.get(pk=old_binary.pk).deployment_id)
        self.assertFalse(TokenDeployment.objects.exists())
        with patch("tokens.services.deployment.get_base_chain_client") as provider:
            self.assertIsNone(deployment.recover(saved[1]["uuid"]))
        provider.assert_not_called()

    def test_reverse_refuses_to_remove_queued_submission_identity(self):
        self.addCleanup(restore_every_migration)
        token = deployment_token("queued-reverse").token
        with self.assertRaisesMessage(DatabaseError, "Cannot remove deployment submission or recovery history"):
            migrate_to([("tokens", "0042_mint_request_operations")])
        restore_every_migration()
        self.assertEqual(ShareToken.objects.get(pk=token.pk).deployment_id, token.deployment_id)

    def test_reverse_refuses_to_remove_admitted_intent(self):
        self.addCleanup(restore_every_migration)
        token = deployment_token("admitted-reverse").token
        command = deployment._admit(token, None)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove deployment submission or recovery history"):
            migrate_to([("tokens", "0042_mint_request_operations")])
        restore_every_migration()
        self.assertEqual(TokenDeployment.objects.get(pk=command.pk).intent, command.intent)
