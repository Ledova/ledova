import json

from django.db import DatabaseError, connection
from django.test import TransactionTestCase, override_settings
from web3 import Web3

from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import SwapApprovalSubmission
from tokens.services import approval_submissions
from tokens.services.settlement_context import recorded_settlement_context
from tokens.services.signed_transactions import decode_signed_transaction
from tokens.tests.swap_approval_submission_fixtures import approval_bytes
from tokens.tests.swap_state_fixtures import CONTRACT, make_swap

BEFORE_JOURNAL = [("tokens", "0058_swap_finality_completion")]
BEFORE_CONTEXT = [("tokens", "0038_order_action_submissions")]
BEFORE_RECOVERY_INDEX = [("tokens", "0060_order_submission_settlement_chain_refusal")]


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapApprovalSubmissionMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)

    def installed(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT to_regclass('tokens_swapapprovalsubmission') IS NOT NULL, "
                "(SELECT count(*) FROM pg_trigger WHERE tgname = 'protect_swap_approval_submission'), "
                "(SELECT count(*) FROM pg_proc WHERE proname = 'protect_swap_approval_submission')"
            )
            return cursor.fetchone()

    def record(self, swap):
        raw = approval_bytes(swap)
        actor = swap.sell_order.owner_account.user_profile.user
        return approval_submissions.record(swap, "seller", raw, decode_signed_transaction(raw), actor.pk)

    def recovery_plan(self):
        with atomic(), connection.cursor() as cursor:
            cursor.execute("SET LOCAL enable_seqscan = off")
            plan = json.loads(
                SwapApprovalSubmission.objects.filter(outcome="pending")
                .order_by("updated_at", "created_at", "pk")
                .values_list("pk", flat=True)[:100]
                .explain(format="JSON")
            )[0]["Plan"]
        nodes = []
        pending = [plan]
        while pending:
            node = pending.pop()
            nodes.append(node)
            pending.extend(node.get("Plans", []))
        return nodes

    def test_recovery_index_supports_the_bounded_order_and_round_trips_without_changing_history(self):
        row = self.record(make_swap("approval-recovery-index"))
        recorded = SwapApprovalSubmission.objects.values().get(pk=row.pk)
        nodes = self.recovery_plan()
        self.assertTrue(any(node.get("Index Name") == "pending_swap_approval_recovery" for node in nodes))
        self.assertFalse(any("Sort" in node["Node Type"] for node in nodes))
        migrate_to(BEFORE_RECOVERY_INDEX)
        self.assertTrue(any("Sort" in node["Node Type"] for node in self.recovery_plan()))
        self.assertEqual(SwapApprovalSubmission.objects.values().get(pk=row.pk), recorded)
        restore_every_migration()
        nodes = self.recovery_plan()
        self.assertTrue(any(node.get("Index Name") == "pending_swap_approval_recovery" for node in nodes))
        self.assertFalse(any("Sort" in node["Node Type"] for node in nodes))
        self.assertEqual(SwapApprovalSubmission.objects.values().get(pk=row.pk), recorded)

    def test_forward_installs_the_journal_and_reverse_removes_it_while_empty(self):
        self.assertEqual(self.installed(), (True, 1, 1))
        migrate_to(BEFORE_JOURNAL)
        self.assertEqual(self.installed(), (False, 0, 0))
        restore_every_migration()
        self.assertEqual(self.installed(), (True, 1, 1))
        row = self.record(make_swap("approval-migration-forward"))
        self.assertEqual(SwapApprovalSubmission.objects.get(pk=row.pk).outcome, "pending")

    def test_reverse_refuses_while_a_submission_is_recorded(self):
        row = self.record(make_swap("approval-migration-reverse"))
        with self.assertRaisesMessage(DatabaseError, "Cannot remove recorded participant approval submissions"):
            migrate_to(BEFORE_JOURNAL)
        restore_every_migration()
        retained = SwapApprovalSubmission.objects.get(pk=row.pk)
        self.assertEqual((retained.tx_hash, bytes(retained.raw_transaction)), (row.tx_hash, bytes(row.raw_transaction)))
        self.assertEqual(self.installed(), (True, 1, 1))

    def test_a_legacy_swap_cannot_acquire_a_submission(self):
        swap = make_swap("approval-migration-legacy")
        context = recorded_settlement_context(swap)
        raw = approval_bytes(swap)
        fields = {
            "swap": swap,
            "participant": "seller",
            "owner_account_id": context["seller"]["owner_account_uuid"],
            "wallet_id": context["seller"]["wallet_uuid"],
            "actor_id": swap.sell_order.owner_account.user_profile.user.pk,
            "settlement_digest": swap.settlement_digest,
            **approval_submissions.party_terms(context, "seller"),
            "nonce": 0,
            "tx_hash": Web3.keccak(raw).to_0x_hex(),
            "raw_transaction": raw,
            "intent": approval_submissions._intent(decode_signed_transaction(raw)),
        }
        migrate_to(BEFORE_CONTEXT)
        restore_every_migration()
        swap.refresh_from_db()
        self.assertEqual(swap.settlement_protocol_version, 0)
        with self.assertRaisesMessage(DatabaseError, "requires its V1 swap"), atomic():
            SwapApprovalSubmission.objects.create(**fields)
        self.assertFalse(SwapApprovalSubmission.objects.exists())
