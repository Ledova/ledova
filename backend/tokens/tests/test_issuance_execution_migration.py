from unittest.mock import patch

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from shared.db import atomic
from tokens.models import ShareIssuanceExecution
from tokens.services import issuance_execution
from tokens.tests.issuance_fixtures import CHAIN_ID, FINALITY_POLICIES, KEY
from tokens.tests.retained_issuance_fixtures import (
    install_retained_issuance,
    retain_signed_issuance,
)


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES
)
class IssuanceFinalityEvidenceTest(TransactionTestCase):
    def setUp(self):
        install_retained_issuance(self)
        self.request, command_id = retain_signed_issuance(
            token=self.token,
            actor=self.actor,
            recipient=self.tenant.wallet.address,
            amount=10,
            client=self.node.client,
        )
        self.command = ShareIssuanceExecution.objects.get(pk=command_id)
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
