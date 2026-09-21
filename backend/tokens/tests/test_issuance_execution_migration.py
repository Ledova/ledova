from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import ShareIssuanceExecution, ShareIssuanceRequest
from tokens.services import issuance_execution
from tokens.tests.issuance_fixtures import (
    CHAIN_ID,
    KEY,
    admit,
    install_issuance,
    issuance_request,
)


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
        restore_every_migration()
        self.assertEqual(ShareIssuanceExecution.objects.get(pk=command.pk).intent, command.intent)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class IssuanceFinalityEvidenceTest(TransactionTestCase):
    def setUp(self):
        install_issuance(self)
        self.command = admit(self.request, self.actor)
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))

    def evidence(self, **changes):
        return {
            "block_number": 12,
            "block_hash": BLOCK_HASH,
            "gas_used": 21000,
            "policy": {"version": 1, "mode": "finalized"},
            **changes,
        }

    def recover(self):
        return issuance_execution.recover(self.command.pk)["status"]

    def test_completion_records_its_finalized_receipt_and_cannot_rewrite_it(self):
        self.assertEqual(self.recover(), "executed")
        execution = ShareIssuanceExecution.objects.get(pk=self.command.pk)
        self.assertEqual(execution.finalized_receipt, self.evidence())
        for value in (None, self.evidence(block_number=13), self.evidence(policy={"version": 1, "mode": "depth"})):
            with self.subTest(value=value), self.assertRaisesMessage(
                DatabaseError, "retain their recorded finality evidence"
            ), atomic():
                ShareIssuanceExecution.objects.filter(pk=execution.pk).update(finalized_receipt=value)
        self.assertEqual(ShareIssuanceExecution.objects.get(pk=execution.pk).finalized_receipt, self.evidence())

    def test_a_first_receipt_completion_without_finality_evidence_is_refused(self):
        self.node.finalized = 11
        self.assertEqual(self.recover(), "executing")
        refusals = (
            ("requires finalized receipt evidence", {"status": "executed"}),
            ("belongs to its completion", {"finalized_receipt": self.evidence()}),
            ("requires its exact block, gas and policy", {"status": "executed", "finalized_receipt": {"block": 12}}),
            (
                "exact nonnegative quantities",
                {"status": "executed", "finalized_receipt": self.evidence(block_number="12")},
            ),
            (
                "belongs to the original confirmed mint journal",
                {"status": "executed", "finalized_receipt": self.evidence(block_number=13)},
            ),
        )
        for message, changes in refusals:
            with self.subTest(message=message), self.assertRaisesMessage(DatabaseError, message), atomic():
                ShareIssuanceExecution.objects.filter(pk=self.command.pk).update(**changes)
        execution = ShareIssuanceExecution.objects.get(pk=self.command.pk)
        self.assertEqual((execution.status, execution.finalized_receipt), ("executing", None))
        self.node.finalized = 12
        self.assertEqual(self.recover(), "executed")
        self.assertEqual(ShareIssuanceExecution.objects.get(pk=self.command.pk).finalized_receipt, self.evidence())

    def test_downgrade_cannot_discard_recorded_issuance_finality_evidence(self):
        self.assertEqual(self.recover(), "executed")
        self.addCleanup(restore_every_migration)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove recorded issuance finality evidence"):
            migrate_to([("tokens", "0065_register_opening")])
        self.assertEqual(ShareIssuanceExecution.objects.get(pk=self.command.pk).finalized_receipt, self.evidence())
