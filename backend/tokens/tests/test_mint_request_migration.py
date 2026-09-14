from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import MintRequest
from tokens.services import mint_service
from tokens.tests.mint_request_fixtures import CHAIN_ID, KEY, mint_request


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class MintRequestMigrationTest(TransactionTestCase):
    def test_history_and_old_binary_inserts_keep_null_dispatch_and_original_receipts(self):
        actor = get_user_model().objects.create_superuser(email="migration@example.test", password="synthetic")
        request = mint_request(actor)
        self.addCleanup(restore_every_migration)
        before = migrate_to([("tokens", "0041_drop_the_token_owner_no_policy_reads")])
        requests = before.get_model("tokens", "MintRequest").objects
        transactions = before.get_model("blockchain", "BlockchainTransaction").objects
        saved = []
        for status in ("pending", "approved", "failed", "executed"):
            record = transactions.create(
                tx_hash="0x" + str(len(saved) + 1) * 64, tx_type="stablecoin_mint", status="submitted"
            )
            old = requests.get(pk=request.pk)
            old.pk = None
            old.status = status
            old.transaction_id = record.pk
            old.save()
            saved.append(requests.filter(pk=old.pk).values().get())
        after = migrate_to([("tokens", "0042_mint_request_operations")])
        for original in saved:
            current = after.get_model("tokens", "MintRequest").objects.filter(pk=original["uuid"]).values().get()
            for field in ("dispatch_id", "execution_intent", "operation_id"):
                self.assertIsNone(current.pop(field))
            self.assertEqual(current, original)
            legacy = MintRequest.objects.get(pk=original["uuid"])
            self.assertFalse(legacy.can_be_executed)
            self.assertEqual(mint_service.recover(legacy.pk), "not_admitted")
        old_binary = requests.get(pk=request.pk)
        old_binary.pk = None
        old_binary.save()
        self.assertIsNone(MintRequest.objects.get(pk=old_binary.pk).dispatch_id)
        new = MintRequest.objects.get(pk=request.pk)
        new.pk = None
        new.dispatch_id = MintRequest._meta.get_field("dispatch_id").get_default()
        new.save()
        self.assertIsNotNone(new.dispatch_id)

    def test_reverse_refuses_to_discard_an_admitted_request(self):
        actor = get_user_model().objects.create_superuser(email="reverse@example.test", password="synthetic")
        request = mint_request(actor)
        mint_service._admit(request.pk, actor, "tokens.change_mintrequest", "")
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted mint recovery history"):
            migrate_to([("tokens", "0041_drop_the_token_owner_no_policy_reads")])
        self.assertIsNotNone(MintRequest.objects.get(pk=request.pk).execution_intent)
