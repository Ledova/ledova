from django.db import connections
from rest_framework.test import APITransactionTestCase

from offerings.models import Subscription
from shared.db import current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import (
    RegisterInstruction,
    RegisterInstructionDecision,
    ShareIssuanceExecution,
)
from tokens.tests.company_paid_issue_fixtures import CompanyPaidIssueCases


class RegisterPaidIssueMigrationTest(CompanyPaidIssueCases, APITransactionTestCase):
    def _guard(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('tokens_guard_register_instruction()')"
            )
            return cursor.fetchone()[0]

    def _finance(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT to_jsonb(subscription) FROM offerings_subscription subscription WHERE uuid=%s",
                [self.subscription.pk],
            )
            return cursor.fetchone()[0]

    def test_empty_roundtrip_preserves_genuine_paid_finance_and_exact_previous_instruction_guard(self):
        before = self._finance()
        current = self._guard()
        try:
            migrate_to([("tokens", "0105_company_register_pause_guards")])
            previous = self._guard()
            self.assertNotEqual(current, previous)
            with use_operator():
                self.assertEqual(self._finance(), before)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT to_regprocedure('tokens_register_paid_issue_approval(uuid,timestamptz)')")
                    self.assertIsNone(cursor.fetchone()[0])
        finally:
            restore_every_migration()
        self.assertEqual(self._guard(), current)
        self.assertEqual(self._finance(), before)
        self.assertEqual(self.execute_paid_issue(self.applied_paid_issue())["status"], "executed")

    def test_prepared_and_applied_paid_history_refuses_reversal_without_losing_source_or_money(self):
        proposal = self.prepare_paid_issue()
        for applied in (False, True):
            if applied:
                self.paid_decide(proposal, "approve")
                proposal, _ = self.paid_decide(proposal, "apply")
            with use_operator():
                source = RegisterInstruction.objects.filter(pk=proposal.pk).values().get()
                money = Subscription.objects.filter(pk=self.subscription.pk).values().get()
                with proposal.file.open("rb") as file:
                    evidence = file.read()
            try:
                with self.assertRaisesMessage(RuntimeError, "Retained company paid issues"):
                    migrate_to([("tokens", "0105_company_register_pause_guards")])
            finally:
                restore_every_migration()
            with use_operator():
                self.assertEqual(RegisterInstruction.objects.filter(pk=proposal.pk).values().get(), source)
                self.assertEqual(Subscription.objects.filter(pk=self.subscription.pk).values().get(), money)
                with proposal.file.open("rb") as file:
                    self.assertEqual(file.read(), evidence)
        with use_operator():
            self.assertEqual(RegisterInstructionDecision.objects.filter(instruction=proposal).count(), 2)
            self.assertEqual(ShareIssuanceExecution.objects.filter(source_instruction=proposal).count(), 1)
        self.assertEqual(self.execute_paid_issue(proposal)["status"], "executed")
