from datetime import timedelta
from unittest import skipUnless
from unittest.mock import call, patch

from django.db import DatabaseError, connection, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.models import BlockchainTransaction, OutgoingOperation, SignedAttempt
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import (
    BLOCK_HASH,
    CHAIN_ID,
    KEY,
    admitted_signer,
    receipt,
)
from shared.db import atomic, current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import SwapNotReadyException
from tokens.models import SwapOrder, SwapOrderStatus, TransferOrder, TransferOrderStatus
from tokens.services import swap_execution
from tokens.services.trading_locks import lock_orders
from tokens.tasks.swap_reconciler import resolve_executing_swaps
from tokens.tests import test_swap_process_concurrency as workers
from tokens.tests.swap_execution_fixtures import (
    ExecutionNode,
    execution_receipt,
    make_execution,
)
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER
from tokens.tests.test_swap_execution_storage import SwapExecutionStorageFixtures

NETWORK = f"evm:{CHAIN_ID}"
FINALIZED = {NETWORK: {"mode": "finalized"}}
DEPTH = {NETWORK: {"mode": "depth", "depth": 3}}
OTHER_HASH = "0x" + "ee" * 32
REORG_HASH = "0x" + "ff" * 32
LOGGER = "tokens.services.swap_execution"


class SwapFinalityFixtures:
    def setUp(self):
        super().setUp()
        self.publisher = self.enterContext(patch.object(swap_execution, "publish_trading_event"))
        with use_operator():
            self.fixture = make_execution("finality")
            admitted_signer()
            for participant, key in (("seller", SELLER), ("buyer", BUYER)):
                self.swap = swap_execution.submit_signature(
                    self.fixture.swap,
                    self.fixture.signatures[participant],
                    key.address,
                    user=getattr(self.fixture, participant).user,
                    participant=participant,
                )
            self.record = self.swap.transaction
        self.node = ExecutionNode(self.record.function_args)

    def confirm(self, status=1):
        self.node.status = status
        with use_operator():
            self.assertEqual(
                swap_execution.recover(self.record.pk, client=self.node.client), "confirmed" if status else "reverted"
            )
            self.record.refresh_from_db()
            self.attempt = SignedAttempt.objects.select_related("operation").get(tx_hash=self.record.tx_hash)
        self.before = self.parents()
        return self.attempt

    def settle(self):
        with use_operator():
            outcome = swap_execution.settle(self.record.pk, client=self.node.client)
            self.swap.refresh_from_db()
        return outcome

    def parents(self):
        with use_operator():
            return {
                row["order_type"]: row
                for row in TransferOrder.objects.filter(pk__in=[order.pk for order in self.fixture.orders]).values(
                    "order_type", "status", "filled_quantity", "tx_hash", "completed_at", "error_message"
                )
            }

    def rows(self):
        with use_operator():
            return (
                SwapOrder.objects.filter(pk=self.swap.pk).values().get(),
                BlockchainTransaction.objects.filter(pk=self.record.pk).values().get(),
                list(
                    TransferOrder.objects.filter(pk__in=[order.pk for order in self.fixture.orders])
                    .order_by("pk")
                    .values()
                ),
            )

    def assert_held(self):
        self.assertEqual((self.swap.status, self.swap.completed_at), (SwapOrderStatus.EXECUTING, None))
        self.assertEqual(self.parents(), self.before)

    def refuse_rpc(self):
        self.node.probe = lambda label: self.fail(f"Settlement performed RPC: {label}")

    def flip(self, status):
        attempt = self.confirm(status)
        self.node.receipts[attempt.tx_hash] = execution_receipt(
            attempt, self.record.function_args, status=1 - status, block_number=14, block_hash=REORG_HASH
        )
        self.node.advance(head=20, finalized=16)
        self.node.blocks[12] = {"hash": OTHER_HASH, "number": 12}
        self.reads = []
        self.node.probe = self.reads.append
        return attempt

    def assert_held_for_attribution(self, attempt, first, finalized, logs):
        self.assertEqual(len(logs), 1)
        self.assertIn(
            f"Swap execution {self.record.pk} hash {attempt.tx_hash} was first seen {first} and finalized {finalized}"
            "; held for operator attribution",
            logs[0],
        )
        self.assertEqual(self.reads.count("receipt"), 1)
        with use_operator():
            self.swap.refresh_from_db()
        self.assert_held()
        self.assertFalse({"swap_completed", "swap_failed"} & {call.args[0] for call in self.publisher.call_args_list})


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapFinalityTest(SwapFinalityFixtures, TransactionTestCase):
    def assert_completed(self, attempt):
        self.assertEqual((self.swap.status, self.swap.tx_hash), (SwapOrderStatus.COMPLETED, attempt.tx_hash))
        self.assertIsNotNone(self.swap.completed_at)
        with use_operator():
            self.assertEqual(SwapOrder.objects.completed_for_token(self.swap.share_token_id).first(), self.swap)
        self.publisher.assert_called_with("swap_completed", str(self.swap.share_token_id))

    def committed(self):
        with use_operator():
            return TransferOrder.objects.committed_sell_quantity(self.swap.share_token_id, self.swap.seller_address)

    def test_completion_releases_the_held_commitment_and_keeps_the_settled_remainder(self):
        self.confirm()
        with use_operator():
            TransferOrder.objects.filter(pk=self.fixture.orders[0].pk).update(quantity=25)
        self.before = self.parents()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.advance(head=20, finalized=12)
            self.assertEqual(self.committed(), 25)
            self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)
        self.assertEqual(self.committed(), 15)
        self.assertEqual(self.parents()["sell"]["status"], TransferOrderStatus.PARTIALLY_FILLED)

    def test_a_confirmed_swap_completes_only_when_the_finalized_head_reaches_its_receipt(self):
        attempt = self.confirm()
        with use_operator():
            TransferOrder.objects.filter(pk=self.fixture.orders[1].pk).update(quantity=25)
        self.before = self.parents()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.advance(head=20, finalized=11)
            self.assertIsNone(self.settle())
            self.assert_held()
            self.node.advance(head=20, finalized=12)
            self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)
        self.assert_completed(attempt)
        parents = self.parents()
        self.assertEqual(
            [(row["status"], row["filled_quantity"], row["tx_hash"]) for row in (parents["sell"], parents["buy"])],
            [
                (TransferOrderStatus.COMPLETED, 10, attempt.tx_hash),
                (TransferOrderStatus.PARTIALLY_FILLED, 10, attempt.tx_hash),
            ],
        )
        self.assertEqual(
            (parents["sell"]["completed_at"], parents["buy"]["completed_at"]), (self.swap.completed_at, None)
        )
        with use_operator():
            reopened = TransferOrder.objects.get(pk=self.fixture.orders[1].pk)
            self.assertTrue(reopened.can_be_modified and reopened.can_cancel)

    def test_a_depth_policy_counts_inclusive_blocks_from_a_stable_tip(self):
        attempt = self.confirm()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=DEPTH):
            self.node.advance(head=13)
            self.assertIsNone(self.settle())
            self.assert_held()
            self.node.advance(head=14)
            self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)
        self.assert_completed(attempt)

    def test_the_local_chain_holds_without_a_policy_and_makes_no_chain_call(self):
        self.confirm()
        self.node.advance(head=40, finalized=40)
        self.refuse_rpc()
        with self.assertLogs(LOGGER, "WARNING") as logs:
            self.assertIsNone(self.settle())
        self.assertIn(f"{self.record.pk} holds without an approved finality policy for {NETWORK}", logs.output[0])
        self.assert_held()

    def test_a_replaced_receipt_block_holds_and_nothing_is_resent(self):
        self.confirm()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.advance(head=20, finalized=15)
            self.node.blocks[12] = {"hash": OTHER_HASH, "number": 12}
            with self.assertLogs(LOGGER, "WARNING") as logs:
                self.assertIsNone(self.settle())
        self.assertIn("receipt_block_replaced", logs.output[0])
        self.assert_held()
        with use_operator():
            self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_moving_tip_holds(self):
        self.confirm()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.advance(head=20, finalized=12)
            heads = [self.node.blocks["latest"], {"hash": OTHER_HASH, "number": 21}]
            canonical = self.node.block
            self.node.block = lambda identifier, full_transactions=False: (
                heads.pop(0) if identifier == "latest" and heads else canonical(identifier)
            )
            with self.assertLogs(LOGGER, "INFO") as logs:
                self.assertIsNone(self.settle())
        self.assertIn("head_changed", logs.output[-1])
        self.assert_held()

    def test_a_reverted_receipt_releases_the_reservation_once_its_revert_is_final(self):
        self.confirm(status=0)
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.advance(head=20, finalized=11)
            self.assertIsNone(self.settle())
            self.assert_held()
            self.node.advance(head=20, finalized=12)
            self.assertEqual(self.settle(), SwapOrderStatus.FAILED)
            released = self.parents()
            self.refuse_rpc()
            self.assertIsNone(self.settle())
        self.assertEqual((self.swap.error_message, self.swap.completed_at), (swap_execution.REVERTED_ON_CHAIN, None))
        for side in ("sell", "buy"):
            self.assertEqual(
                (released[side]["status"], released[side]["filled_quantity"], released[side]["error_message"]),
                (TransferOrderStatus.OPEN, 0, swap_execution.REVERTED_ON_CHAIN),
            )
        self.assertEqual(self.parents(), released)
        self.publisher.assert_called_with("swap_failed", str(self.swap.share_token_id))

    def test_the_same_hash_finalized_in_a_later_block_completes_after_the_event_re_verifies(self):
        attempt = self.confirm()
        arguments = self.record.function_args
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.receipts[attempt.tx_hash] = execution_receipt(
                attempt, arguments, changes={"paymentAmount": 1501}, block_number=14, block_hash=REORG_HASH
            )
            self.node.advance(head=20, finalized=16)
            self.assertIsNone(self.settle())
            self.assert_held()
            self.node.blocks[12] = {"hash": OTHER_HASH, "number": 12}
            with self.assertRaises(SwapNotReadyException):
                self.settle()
            self.assert_held()
            self.node.receipts[attempt.tx_hash] = execution_receipt(
                attempt, arguments, block_number=14, block_hash=REORG_HASH
            )
            with self.assertLogs(LOGGER, "INFO") as logs:
                self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)
        self.assertIn("later block", logs.output[-1])
        self.assert_completed(attempt)
        with use_operator():
            operation = OutgoingOperation.objects.get(pk=self.record.outgoing_operation_id)
            self.record.refresh_from_db()
        self.assertEqual((operation.block_number, operation.block_hash), (12, BLOCK_HASH))
        self.assertEqual((self.record.block_number, self.record.block_hash), (12, BLOCK_HASH))

    def test_a_first_seen_revert_finalized_as_a_success_is_held_for_attribution(self):
        attempt = self.flip(0)
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED), self.assertLogs(LOGGER, "WARNING") as logs:
            self.assertIsNone(self.settle())
        self.assert_held_for_attribution(attempt, "reverted", "confirmed", logs.output)

    def test_a_first_seen_success_finalized_as_a_revert_is_held_for_attribution(self):
        attempt = self.flip(1)
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED), self.assertLogs(LOGGER, "WARNING") as logs:
            self.assertIsNone(self.settle())
        self.assert_held_for_attribution(attempt, "confirmed", "reverted", logs.output)

    def test_the_sweep_logs_a_flipped_outcome_once_rather_than_a_database_refusal(self):
        attempt = self.flip(0)
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED), patch.object(
            swap_execution, "get_base_chain_client", return_value=self.node.client
        ), use_operator(), self.assertLogs("tokens", "WARNING") as logs:
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 0})
        self.assert_held_for_attribution(attempt, "reverted", "confirmed", logs.output)

    def test_a_settled_swap_is_left_alone_without_writes_or_chain_calls(self):
        self.confirm()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
            self.node.advance(head=20, finalized=12)
            self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)
            settled = self.rows()
            self.refuse_rpc()
            self.assertIsNone(self.settle())
        self.assertEqual(self.rows(), settled)
        self.assertEqual(self.publisher.call_args_list.count(call("swap_completed", str(self.swap.share_token_id))), 1)

    def test_the_sweep_settles_a_confirmed_executing_swap_and_then_leaves_it(self):
        self.confirm()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED), patch.object(
            swap_execution, "get_base_chain_client", return_value=self.node.client
        ), use_operator():
            self.node.advance(head=20, finalized=11)
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 0})
            self.node.advance(head=20, finalized=12)
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 1})
            self.assertEqual(resolve_executing_swaps(), {"checked": 0, "resolved": 0})
            self.swap.refresh_from_db()
        self.assertEqual(self.swap.status, SwapOrderStatus.COMPLETED)

    def test_the_sweep_also_settles_a_reverted_transaction(self):
        self.confirm(status=0)
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED), patch.object(
            swap_execution, "get_base_chain_client", return_value=self.node.client
        ), use_operator():
            self.node.advance(head=20, finalized=12)
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 1})
            self.swap.refresh_from_db()
        self.assertEqual(self.swap.status, SwapOrderStatus.FAILED)


class ScopedSwapFinalityTest(RunsOnTheScopedConnection, SwapFinalityTest):
    pass


@skipUnless(connection.vendor == "postgresql", "Independent processes require PostgreSQL row locks")
@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapFinalityProcessTest(SwapFinalityFixtures, TransactionTestCase):
    def wait_for_row_lock(self, child, table, blocker_pid=None):
        workers.SwapWorkersUseOneCurrentClaimTest.wait_for_row_lock(self, child, table, blocker_pid)

    def test_two_settlement_workers_wait_for_the_orders_and_complete_once(self):
        attempt = self.confirm()
        first = workers.SwapProcess(self, "settle", self.swap.pk)
        second = workers.SwapProcess(self, "settle", self.swap.pk)
        with atomic():
            lock_orders(TransferOrder.objects.filter(pk__in=[self.swap.sell_order_id, self.swap.buy_order_id]))
            for worker, blocker in ((first, None), (second, first.database_pid)):
                worker.send("run")
                worker.receive("settling")
                self.wait_for_row_lock(worker, "tokens_transferorder", blocker)
        outcomes = [first.done()["result"], second.done()["result"]]
        self.assertEqual(sorted(outcomes, key=str), [None, "completed"])
        self.swap.refresh_from_db()
        self.assertEqual((self.swap.status, self.swap.tx_hash), (SwapOrderStatus.COMPLETED, attempt.tx_hash))
        self.assertEqual(
            {side: (row["status"], row["filled_quantity"]) for side, row in self.parents().items()},
            {"sell": (TransferOrderStatus.COMPLETED, 10), "buy": (TransferOrderStatus.COMPLETED, 10)},
        )


@override_settings(BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class SwapFinalityGuardTest(SwapExecutionStorageFixtures, TransactionTestCase):
    def retain(self, status=1):
        journal = self.admit()
        claim = self.open(journal)
        attempt = self.sign(journal, claim)
        outgoing.record_receipt(claim, attempt.tx_hash, receipt(attempt, status))
        return journal

    def project(self, journal, status):
        journal.status = status
        journal.block_number = 12
        journal.block_hash = BLOCK_HASH
        journal.gas_used = 21000
        journal.confirmed_at = timezone.now()
        journal.save(update_fields=["status", "block_number", "block_hash", "gas_used", "confirmed_at", "updated_at"])

    def refuse(self, message, **changes):
        with self.assertRaisesMessage(DatabaseError, message), atomic():
            SwapOrder.objects.filter(pk=self.swap.pk).update(**changes)

    def test_completion_needs_the_confirmed_journal_its_operation_and_a_completion_time(self):
        journal = self.retain()
        now = timezone.now()
        self.refuse("confirmed original receipt", status="completed", completed_at=now)
        self.project(journal, "confirmed")
        self.refuse("exact admitted state", status="completed")
        self.refuse("exact admitted state", completed_at=now)
        self.refuse("original execution hash", status="completed", completed_at=now, tx_hash="0x" + "f" * 64)
        self.refuse("held until finality", status="failed")
        self.refuse("executing to completed or failed", status="ready")
        self.assertEqual(SwapOrder.objects.filter(pk=self.swap.pk).update(status="completed", completed_at=now), 1)
        completed = SwapOrder.objects.get(pk=self.swap.pk)
        self.assertEqual((completed.status, completed.completed_at), ("completed", now))
        self.refuse("terminal", status="executing", completed_at=None)
        self.refuse("terminal", status="failed", completed_at=None)
        self.refuse("terminal", completed_at=now + timedelta(seconds=1))
        self.assertEqual(SwapOrder.objects.filter(pk=self.swap.pk).update(error_message="noted"), 1)

    def test_a_reverted_journal_permits_failure_and_refuses_completion(self):
        journal = self.retain(status=0)
        self.project(journal, "reverted")
        self.refuse("confirmed original receipt", status="completed", completed_at=timezone.now())
        self.swap.refresh_from_db()
        self.swap.mark_failed("reverted")
        failed = SwapOrder.objects.get(pk=self.swap.pk)
        self.assertEqual((failed.status, failed.error_message), ("failed", "reverted"))
        self.refuse("terminal", status="executing")
        self.refuse("terminal", status="completed", completed_at=timezone.now())

    def test_reversing_the_guard_restores_the_previous_function_verbatim(self):
        self.addCleanup(restore_every_migration)

        def definition():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT pg_get_functiondef('protect_swap_execution'::regproc)")
                return cursor.fetchone()[0]

        current = definition()
        self.assertIn("confirmed original receipt", current)
        migrate_to([("tokens", "0057_swap_execution_guards")])
        reverted = definition()
        migrate_to([("tokens", "0056_hold_legacy_swaps")])
        migrate_to([("tokens", "0057_swap_execution_guards")])
        self.assertEqual(definition(), reverted)
        self.assertNotIn("confirmed original receipt", reverted)
        restore_every_migration()
        self.assertEqual(definition(), current)
