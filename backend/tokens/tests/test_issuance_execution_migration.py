from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import ShareIssuanceExecution, ShareIssuanceRequest
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY, admit, issuance_request


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class IssuanceExecutionMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_historical_mints_terms_links_and_journals_without_admitting_them(self):
        tenant = make_tenant("issuance-history")
        self.addCleanup(restore_every_migration)
        before = migrate_to([("tokens", "0046_capital_execution_guards")])
        requests = before.get_model("tokens", "ShareIssuanceRequest").objects
        issuances = before.get_model("tokens", "ShareIssuance").objects
        originals = []
        journals = (
            None,
            [],
            [{"id": str(uuid4())}],
            [{"id": str(uuid4()), "abandoned": True}],
            [{"tx_hash": "0x" + "ab" * 32, "raw_transaction": "0xdead", "reverted": True}],
        )
        for state, journal in zip(("approved", "executing", "failed", "rejected", "executed"), journals):
            request = requests.create(
                token_id=tenant.deployed_token.pk,
                company_id=tenant.company.pk,
                recipient_address=tenant.wallet.address,
                recipient_name="Historical name",
                amount=10,
                reason="Historical approved terms",
                status=state,
                execution_notes="Original observations",
            )
            issuance = issuances.create(
                token_id=tenant.deployed_token.pk,
                recipient_address=tenant.wallet.address,
                recipient_name="Stamped name",
                amount="10",
                status="completed" if state == "executed" else "failed",
                mint_journal=journal,
                idempotency_key=f"issuance-request:{request.pk}",
            )
            if state == "executed":
                requests.filter(pk=request.pk).update(executed_issuance=issuance)
            originals.append(
                (requests.filter(pk=request.pk).values().get(), issuances.filter(pk=issuance.pk).values().get())
            )
        after = migrate_to([("tokens", "0048_issuance_execution_guards")])
        for original, issuance in originals:
            current = (
                after.get_model("tokens", "ShareIssuanceRequest").objects.filter(pk=original["uuid"]).values().get()
            )
            self.assertIsNone(current.pop("dispatch_id"))
            self.assertEqual(current, original)
            self.assertEqual(issuances.filter(pk=issuance["uuid"]).values().get(), issuance)
        self.assertFalse(ShareIssuanceExecution.objects.exists())
        old_binary = requests.create(
            token_id=tenant.deployed_token.pk,
            company_id=tenant.company.pk,
            recipient_address=tenant.wallet.address,
            amount=1,
            reason="Old binary request",
        )
        self.assertIsNone(ShareIssuanceRequest.objects.get(pk=old_binary.pk).dispatch_id)
        current = ShareIssuanceRequest.objects.create(
            token=tenant.deployed_token, recipient_address=tenant.wallet.address, amount=1, reason="New request"
        )
        self.assertIsNotNone(current.dispatch_id)

    def test_reverse_refuses_to_erase_queued_admission_history(self):
        self.addCleanup(restore_every_migration)
        tenant, actor = issuance_request("issuance-reverse")
        command = admit(tenant.issuance_request, actor)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted issuance execution history"):
            migrate_to([("tokens", "0046_capital_execution_guards")])
        self.assertEqual(ShareIssuanceExecution.objects.get(pk=command.pk).intent, command.intent)
