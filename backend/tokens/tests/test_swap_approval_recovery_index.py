import json

from django.db import connection
from django.test import TransactionTestCase, override_settings

from shared.db import atomic
from tokens.models import SwapApprovalSubmission
from tokens.services import approval_submissions
from tokens.services.signed_transactions import decode_signed_transaction
from tokens.tests.swap_approval_submission_fixtures import approval_bytes
from tokens.tests.swap_state_fixtures import CONTRACT, make_swap


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapApprovalRecoveryIndexTest(TransactionTestCase):

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

    def test_recovery_index_supports_the_bounded_order_without_changing_history(self):
        row = self.record(make_swap("approval-recovery-index"))
        recorded = SwapApprovalSubmission.objects.values().get(pk=row.pk)

        nodes = self.recovery_plan()
        self.assertTrue(any(node.get("Index Name") == "pending_swap_approval_recovery" for node in nodes))
        self.assertFalse(any("Sort" in node["Node Type"] for node in nodes))
        self.assertEqual(SwapApprovalSubmission.objects.values().get(pk=row.pk), recorded)
