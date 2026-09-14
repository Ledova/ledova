from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit, capital_request


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class CapitalExecutionMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_every_historical_term_status_and_transaction_without_authority(self):
        tenant = make_tenant("capital-history")
        self.addCleanup(restore_every_migration)
        before = migrate_to([("tokens", "0044_token_deployment_guards")])
        rows = before.get_model("tokens", "CapitalIncreaseRequest").objects
        transactions = before.get_model("blockchain", "BlockchainTransaction").objects
        originals = []
        for index, status in enumerate(("draft", "failed", "executed", "superseded", "executing")):
            old = rows.create(
                token_id=tenant.deployed_token.pk,
                company_id=tenant.company.pk,
                additional_shares=100,
                new_authorized_total=1100,
                status=status,
                purpose="Historical approved terms",
                board_resolution_reference=f"BOARD-{index}",
                execution_notes="Historical operator notes retained",
            )
            record = transactions.create(
                tx_hash="0x" + str(index + 1) * 64,
                tx_type="other",
                status="submitted",
                related_model="tokens.CapitalIncreaseRequest",
                related_uuid=old.pk,
            )
            originals.append((rows.filter(pk=old.pk).values().get(), transactions.filter(pk=record.pk).values().get()))
        after = migrate_to([("tokens", "0046_capital_execution_guards")])
        for original, transaction in originals:
            current = (
                after.get_model("tokens", "CapitalIncreaseRequest").objects.filter(pk=original["uuid"]).values().get()
            )
            self.assertIsNone(current.pop("dispatch_id"))
            self.assertEqual(current, original)
            self.assertEqual(transactions.filter(pk=transaction["uuid"]).values().get(), transaction)
        self.assertFalse(CapitalIncreaseExecution.objects.exists())
        old_binary = rows.create(
            token_id=tenant.deployed_token.pk,
            company_id=tenant.company.pk,
            additional_shares=100,
            new_authorized_total=1100,
            purpose="Old binary draft",
            board_resolution_reference="OLD-BINARY",
        )
        self.assertIsNone(CapitalIncreaseRequest.objects.get(pk=old_binary.pk).dispatch_id)
        new = CapitalIncreaseRequest.objects.create(
            token=tenant.deployed_token,
            additional_shares=100,
            new_authorized_total=1100,
            purpose="New draft",
            board_resolution_reference="NEW",
        )
        self.assertIsNotNone(new.dispatch_id)

    def test_reverse_refuses_to_erase_committed_capital_admission(self):
        self.addCleanup(restore_every_migration)
        tenant, actor = capital_request("capital-reverse")
        command = admit(tenant.capital_increase, actor)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted capital execution history"):
            migrate_to([("tokens", "0044_token_deployment_guards")])
        self.assertEqual(CapitalIncreaseExecution.objects.get(pk=command.pk).intent, command.intent)
