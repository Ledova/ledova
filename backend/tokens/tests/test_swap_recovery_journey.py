import signal
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import override_settings
from eth_account.messages import encode_typed_data
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction, SignedAttempt
from blockchain.tests.outgoing_fixtures import admitted_signer
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import (
    SwapApprovalSubmission,
    SwapOrder,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.services import atomic_swap_service, swap_execution
from tokens.tasks.approval_submissions import recover_swap_approval_submissions
from tokens.tests.order_process_fixtures import OrderChild
from tokens.tests.order_submission_fixtures import (
    COUNTERPARTY,
    OWNER,
    SubmissionFixtures,
)
from tokens.tests.swap_approval_submission_fixtures import approval_bytes, approval_node
from tokens.tests.swap_execution_fixtures import ExecutionNode

WORKER = "order_submission_worker"
RELAYER_KEY = "0x" + "11" * 32


class SwapRecoveryJourneyChecks(SubmissionFixtures):
    def setUp(self):
        super().setUp()
        with use_operator():
            admitted_signer(chain_id=settings.BLOCKCHAIN_CHAIN_ID)
        self.ledger = approval_node(self)

    def signed_message(self, key):
        return key.sign_message(encode_typed_data(full_message=atomic_swap_service.get_typed_data(self.swap)))

    def sign_route(self, order, key):
        self.client.force_authenticate(self.tenant.user)
        return self.client.post(
            f"/api/v1/trading/orders/{order.pk}/swap/sign/",
            {
                "swap_uuid": str(self.swap.pk),
                "owner_account_uuid": str(order.owner_account_id),
                "wallet_uuid": str(order.wallet_id),
                "settlement_digest": self.swap.settlement_digest,
                "signature": self.signed_message(key).signature.to_0x_hex(),
                "signer_address": key.address,
            },
            format="json",
        )

    def approval_route(self, order, raw):
        self.client.force_authenticate(self.tenant.user)
        return self.client.post(
            f"/api/v1/trading/orders/{order.pk}/swap/approval-broadcast/",
            {
                "swap_uuid": str(self.swap.pk),
                "owner_account_uuid": str(order.owner_account_id),
                "wallet_uuid": str(order.wallet_id),
                "settlement_digest": self.swap.settlement_digest,
                "signed_transaction": raw.hex(),
            },
            format="json",
        )

    def journey(self):
        counter = self.counter_order()
        signed = self.signed_body()
        with tempfile.TemporaryDirectory(prefix="swap-recovery-journey-") as temporary:
            directory = Path(temporary)
            child = OrderChild(self, WORKER, "committed", directory, body=signed)
            self.assertEqual(child.wait(), -signal.SIGKILL, child.error_output())
        with use_operator():
            self.swap = SwapOrder.objects.select_related("sell_order", "buy_order").get(sell_order_id=counter.pk)
            orders_before = TransferOrder.objects.count()
            swaps_before = SwapOrder.objects.count()
        retry = self.create(signed)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json()["status"], "created")
        with use_operator():
            self.assertEqual(TransferOrder.objects.count(), orders_before)
            self.assertEqual(SwapOrder.objects.count(), swaps_before)

        sell_order = self.swap.sell_order
        buy_order = self.swap.buy_order
        self.ledger.confirm = False
        self.ledger.lose_acknowledgement = True
        seller_raw = approval_bytes(self.swap, key=COUNTERPARTY, participant="seller")
        uncertain = self.approval_route(sell_order, seller_raw)
        self.assertEqual(uncertain.status_code, 503, uncertain.content)
        with use_operator():
            row = SwapApprovalSubmission.objects.get(tx_hash__iexact=uncertain.json()["txHash"])
        self.assertEqual((row.outcome, self.ledger.broadcasts), ("pending", [seller_raw]))
        self.ledger.lose_acknowledgement = False
        self.ledger.confirm = True
        self.ledger.mine(row.tx_hash)
        self.assertEqual(recover_swap_approval_submissions(0), {"attempted": 1, "outcomes": {"confirmed": 1}})
        buyer_raw = approval_bytes(self.swap, key=OWNER, participant="buyer")
        confirmed = self.approval_route(buy_order, buyer_raw)
        self.assertEqual(confirmed.status_code, 200, confirmed.content)

        first = self.sign_route(sell_order, COUNTERPARTY)
        self.assertEqual((first.status_code, first.json()["status"]), (200, "seller_signed"), first.content)
        completing = self.sign_route(buy_order, OWNER)
        self.assertEqual((completing.status_code, completing.json()["status"]), (200, "executing"), completing.content)
        repeated = self.sign_route(buy_order, OWNER)
        self.assertEqual((repeated.status_code, repeated.json()["status"]), (200, "executing"), repeated.content)

        with use_operator():
            self.swap.refresh_from_db()
            self.record = BlockchainTransaction.objects.get(pk=self.swap.transaction_id)
            self.node = ExecutionNode(self.record.function_args)
            self.assertEqual(swap_execution.recover(self.record.pk, client=self.node.client), "confirmed")
            self.record.refresh_from_db()
            self.swap.refresh_from_db()
        self.assertEqual(self.swap.status, "executing")

        self.node.advance(head=14, finalized=12)
        with use_operator():
            completed = swap_execution.settle(self.record.pk, client=self.node.client)
            self.swap.refresh_from_db()
            parents = list(
                TransferOrder.objects.filter(pk__in=[self.swap.sell_order_id, self.swap.buy_order_id]).order_by("pk")
            )
            attempt = SignedAttempt.objects.select_related("operation").get(tx_hash=self.record.tx_hash)
        self.assertEqual(completed, "completed")
        self.assertEqual(self.swap.status, "completed")
        self.assertIsNotNone(self.swap.completed_at)
        self.assertEqual(
            [(parent.status, parent.filled_quantity) for parent in parents],
            [(TransferOrderStatus.COMPLETED, 10), (TransferOrderStatus.COMPLETED, 10)],
        )
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(attempt.tx_hash, self.record.tx_hash)
        with use_operator():
            self.assertIsNone(swap_execution.settle(self.record.pk, client=self.node.client))

    def test_one_journey_crashes_at_each_stage_and_recovers_to_a_completed_swap(self):
        self.journey()


@override_settings(BLOCKCHAIN_OPERATOR_KEY=RELAYER_KEY)
class SwapRecoveryJourneyTest(SwapRecoveryJourneyChecks, APITransactionTestCase):
    pass


@override_settings(BLOCKCHAIN_OPERATOR_KEY=RELAYER_KEY)
class ScopedSwapRecoveryJourneyTest(RunsOnTheScopedConnection, SwapRecoveryJourneyChecks, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            user = self.tenant.account.user_profile.user
        self.the_principal_the_middleware_would_set(user)
        self.addCleanup(self.no_principal_is_set)
