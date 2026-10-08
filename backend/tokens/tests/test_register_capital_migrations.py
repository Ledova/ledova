from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.models import SignedAttempt, SigningAccount
from blockchain.services import outgoing
from shared.db import use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import CapitalIncreaseExecution, RegisterCapitalIncrease
from tokens.services import capital_execution
from tokens.tests.capital_fixtures import CHAIN_ID, KEY
from tokens.tests.company_capital_fixtures import CompanyCapitalCases
from tokens.tests.retained_capital_fixtures import (
    install_retained_capital,
    retain_capital_execution,
)


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "finalized"}},
)
class RetainedCapitalHistoryTest(TransactionTestCase):
    def setUp(self):
        install_retained_capital(self)

    def test_original_signed_history_and_deleted_staff_actor_recover_without_backfilled_company_authority(self):
        request, execution = retain_capital_execution(token=self.token, actor=self.actor, client=self.node.client)
        with use_operator():
            attempt = SignedAttempt.objects.get(operation_id=execution.operation_id)
            original = (
                bytes(attempt.raw_transaction),
                attempt.tx_hash,
                attempt.nonce,
                execution.intent,
                execution.executed_by_id,
            )
            self.actor.delete()
            self.assertIsNone(execution.source_increase_id)
            self.assertEqual(capital_execution.recover(execution.pk)["status"], "executed")
            execution.refresh_from_db()
            attempt.refresh_from_db()
            self.assertEqual(
                (
                    bytes(attempt.raw_transaction),
                    attempt.tx_hash,
                    attempt.nonce,
                    execution.intent,
                    execution.executed_by_id,
                ),
                original,
            )
            self.assertFalse(RegisterCapitalIncrease.objects.exists())
            self.assertIsNone(execution.source_increase_id)

    def test_retained_unsigned_null_source_holds_and_cannot_create_a_new_signature_under_current_guards(self):
        request, execution = retain_capital_execution(
            token=self.token, actor=self.actor, client=self.node.client, signed=False
        )
        with use_operator():
            before = SigningAccount.objects.get().next_nonce
            self.assertEqual(capital_execution.recover(execution.pk)["status"], "executing")
            execution.refresh_from_db()
            operation = execution.operation
            claim = outgoing.OperationClaim(operation.pk, operation.claim_id)
            prepared = outgoing.prepare_operation(claim, self.node.client)
            with self.assertRaisesMessage(outgoing.OutgoingTransactionError, "could not be committed"):
                outgoing.sign_operation(claim, prepared, KEY)
            self.assertFalse(SignedAttempt.objects.filter(operation=operation).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, before)
            self.assertIsNone(execution.source_increase_id)
        self.assertFalse(self.node.broadcasts)

    def test_retained_unsigned_superseded_terms_are_not_rewritten_or_signed(self):
        request, execution = retain_capital_execution(
            token=self.token,
            actor=self.actor,
            client=self.node.client,
            new_authorized_total=900,
            signed=False,
            superseded=True,
        )
        with use_operator():
            self.assertEqual(capital_execution.recover(execution.pk)["status"], "superseded")
            execution.refresh_from_db()
            self.assertEqual(
                (
                    execution.intent["prior_authorized_total"],
                    execution.intent["additional_shares"],
                    execution.intent["new_authorized_total"],
                ),
                ("1000", "100", "900"),
            )
            self.assertIsNone(execution.source_increase_id)
            self.assertFalse(SignedAttempt.objects.exists())

    def test_empty_source_schema_roundtrip_preserves_actual_original_signed_private_journal(self):
        request, execution = retain_capital_execution(token=self.token, actor=self.actor, client=self.node.client)
        with use_operator():
            attempt = SignedAttempt.objects.get(operation_id=execution.operation_id)
            original = (
                execution.pk,
                execution.intent,
                bytes(attempt.raw_transaction),
                attempt.tx_hash,
                request.review_notes,
            )
        try:
            migrate_to([("tokens", "0101_company_register_issue_guards")])
        finally:
            restore_every_migration()
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(pk=execution.pk)
            attempt.refresh_from_db()
            request.refresh_from_db()
            self.assertEqual(
                (execution.pk, execution.intent, bytes(attempt.raw_transaction), attempt.tx_hash, request.review_notes),
                original,
            )
            self.assertIsNone(execution.source_increase_id)
            self.assertEqual(capital_execution.recover(execution.pk)["status"], "executed")


class CapitalSourceRetentionMigrationTest(CompanyCapitalCases, APITransactionTestCase):
    def test_downgrade_refuses_to_discard_actual_company_capital_sources_and_decisions(self):
        proposal = self.prepare_capital()
        self.capital_decide(proposal, "approve")
        try:
            with self.assertRaises(DatabaseError):
                migrate_to([("tokens", "0102_company_register_capital_increases")])
        finally:
            restore_every_migration()
        with use_operator():
            proposal.refresh_from_db()
            self.assertEqual(proposal.decisions.count(), 1)
            self.assertEqual(proposal.status, "submitted")
