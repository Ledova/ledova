import json
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import (
    IssuanceExecutionStatus,
    RegisterReconciliation,
    ShareIssuanceExecution,
)
from tokens.services import issuance_execution
from tokens.services.register import RECONCILED_ROW, export_rows
from tokens.services.register_reconciliation import reconcile_register
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tasks.register_reconciliation import reconcile_every_register
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_inclusions import MINT_BLOCK, InclusionFixtures
from tokens.tests.test_register_openings import ALICE, BOB, SETTINGS
from tokens.tests.test_register_snapshot import block_hash

LATER = MINT_BLOCK + 4


@override_settings(**SETTINGS)
class RegisterReconciliationTest(InclusionFixtures, TransactionTestCase):
    def opened(self):
        issuance = self.mint()
        self.open_holding_the_mint(issuance)
        return issuance

    def chain(self, height, *transfers, holdings):
        self.boundary_at(height, holdings=holdings, transfers=list(transfers))

    def reconcile(self):
        return reconcile_register(self.tenant.token.pk, client=self.node.client)

    def kinds(self, record):
        return sorted(item["kind"] for item in record.discrepancies)

    def test_recorded_effects_that_match_the_chain_reconcile(self):
        first = self.opened()
        later = self.mint(block=LATER)
        self.chain(
            LATER + 2,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER, ZERO_ADDRESS, self.recipient, 10, later.tx_hash),
            holdings={self.recipient: 20},
        )
        record = self.reconcile()
        self.assertEqual(
            (record.status, record.discrepancies, record.block_number, record.register_sequence, record.failure),
            ("matched", [], LATER + 2, 2, ""),
        )
        self.assertEqual(record.block_hash, block_hash(LATER + 2))

    def test_a_transfer_made_outside_the_platform_is_reported(self):
        first = self.opened()
        self.chain(
            LATER,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER - 1, self.recipient, BOB, 3, None),
            holdings={self.recipient: 7, BOB: 3},
        )
        with self.assertLogs("tokens.services.register_reconciliation", "ERROR"):
            record = self.reconcile()
        self.assertEqual(record.status, "discrepant")
        by_kind = {item["kind"]: item for item in record.discrepancies}
        self.assertEqual(sorted(by_kind), ["member", "unlinked", "unrecognised_transfer"])
        self.assertEqual(by_kind["unrecognised_transfer"]["block"], LATER - 1)
        self.assertEqual((by_kind["member"]["chain"], by_kind["member"]["expected"]), ("7", "10"))
        self.assertEqual(
            (by_kind["unlinked"]["address"], by_kind["unlinked"]["chain"], by_kind["unlinked"]["expected"]),
            (BOB.lower(), "3", "0"),
        )

    def test_a_mint_outside_the_platform_breaks_the_supply(self):
        first = self.opened()
        self.chain(
            LATER,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER - 1, ZERO_ADDRESS, self.recipient, 5, None),
            holdings={self.recipient: 15},
        )
        record = self.reconcile()
        self.assertEqual(self.kinds(record), ["member", "supply", "unrecognised_transfer"])
        supply = next(item for item in record.discrepancies if item["kind"] == "supply")
        self.assertEqual((supply["chain"], supply["expected"]), ("15", "10"))

    def test_a_completed_effect_waiting_for_its_link_explains_its_holder(self):
        first = self.opened()
        waiting = self.mint(block=LATER, recipient=ALICE, amount=5)
        self.chain(
            LATER + 1,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER, ZERO_ADDRESS, ALICE, 5, waiting.tx_hash),
            holdings={self.recipient: 10, ALICE: 5},
        )
        record = self.reconcile()
        self.assertEqual((record.status, record.register_sequence), ("matched", 1))

    def test_an_issuance_still_in_flight_explains_its_transaction(self):
        first = self.opened()
        command = self.admitted(amount=4, block=LATER)
        self.mint_node.finalized = LATER - 1
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        execution = ShareIssuanceExecution.objects.get(pk=command.pk)
        self.assertEqual(execution.status, IssuanceExecutionStatus.EXECUTING)
        in_flight = execution.operation.attempts.get().tx_hash
        self.chain(
            LATER + 1,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER, ZERO_ADDRESS, self.recipient, 4, in_flight),
            holdings={self.recipient: 14},
        )
        self.assertEqual(self.reconcile().status, "matched")

    def test_an_effect_recorded_beyond_the_snapshot_is_left_out_of_the_comparison(self):
        first = self.opened()
        self.mint(block=LATER + 3)
        self.chain(LATER, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10})
        record = self.reconcile()
        self.assertEqual((record.status, record.register_sequence), ("matched", 2))

    def test_a_recorded_effect_missing_from_the_chain_is_reported(self):
        first = self.opened()
        later = self.mint(block=LATER)
        self.chain(
            LATER + 1, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10}
        )
        record = self.reconcile()
        self.assertEqual(self.kinds(record), ["member", "missing_transfer", "supply"])
        missing = next(item for item in record.discrepancies if item["kind"] == "missing_transfer")
        self.assertEqual((missing["source"], missing["transaction"]), (str(later.pk), later.tx_hash.lower()))

    def test_an_unreadable_chain_is_a_failed_reconciliation_not_a_register_failure(self):
        self.opened()
        self.node.client.assert_expected_chain.return_value = 999
        with self.assertLogs("tokens.services.register_reconciliation", "WARNING"):
            record = self.reconcile()
        self.assertEqual((record.status, record.block_number, record.discrepancies), ("failed", None, []))
        self.assertIn("original deployment chain", record.failure)
        summary = [row for row in export_rows(self.tenant.token, self.owner) if row and row[0] == RECONCILED_ROW]
        self.assertEqual(summary[0][:3], [RECONCILED_ROW, "failed", ""])

    def test_a_share_class_without_an_applied_opening_is_not_reconciled(self):
        self.mint()
        self.assertIsNone(self.reconcile())
        self.assertFalse(RegisterReconciliation.objects.exists())

    def test_the_export_states_the_latest_reconciliation(self):
        first = self.opened()
        summary = [row for row in export_rows(self.tenant.token, self.owner) if row and row[0] == RECONCILED_ROW]
        self.assertEqual(summary, [[RECONCILED_ROW, "never"]])
        self.chain(
            MINT_BLOCK + 2,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (MINT_BLOCK + 1, self.recipient, BOB, 3, None),
            holdings={self.recipient: 7, BOB: 3},
        )
        record = self.reconcile()
        summary = [row for row in export_rows(self.tenant.token, self.owner) if row and row[0] == RECONCILED_ROW]
        self.assertEqual(
            summary,
            [[RECONCILED_ROW, "3 discrepancies", f"block {MINT_BLOCK + 2}", record.created_at.isoformat()]],
        )

    def test_records_are_retained_as_written_and_consistent_with_their_status(self):
        first = self.opened()
        self.chain(
            MINT_BLOCK + 1, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10}
        )
        record = self.reconcile()
        with self.assertRaises(DatabaseError), atomic():
            RegisterReconciliation.objects.filter(pk=record.pk).update(block_number=record.block_number + 1)
        with self.assertRaises(DatabaseError), atomic():
            record.delete()
        valid = {"token": self.tenant.token, "block_number": 1, "block_hash": "0x" + "ab" * 32, "register_sequence": 1}
        for fields in (
            {**valid, "status": "matched", "discrepancies": [{"kind": "supply"}]},
            {**valid, "status": "discrepant", "discrepancies": []},
            {**valid, "status": "matched", "block_hash": "0xnope"},
            {"token": self.tenant.token, "status": "failed", "failure": " "},
            {**valid, "status": "failed", "failure": "unreadable"},
            {**valid, "status": "pending"},
        ):
            with self.subTest(fields=fields), self.assertRaises(DatabaseError), atomic():
                RegisterReconciliation.objects.create(**fields)
        self.assertEqual(RegisterReconciliation.objects.count(), 1)

    def test_the_task_reconciles_every_opened_share_class_and_survives_an_unexpected_error(self):
        first = self.opened()
        self.chain(
            MINT_BLOCK + 1, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10}
        )
        with patch("tokens.services.register_snapshot.get_base_chain_client", return_value=self.node.client):
            self.assertEqual(reconcile_every_register(), {"matched": 1, "discrepant": 0, "failed": 0})
            with (
                patch("tokens.tasks.register_reconciliation.reconcile_register", side_effect=RuntimeError("boom")),
                self.assertLogs("tokens.tasks.register_reconciliation", "ERROR"),
            ):
                self.assertEqual(reconcile_every_register(), {"matched": 0, "discrepant": 0, "failed": 1})

    def test_the_command_prints_the_recorded_result(self):
        first = self.opened()
        self.chain(
            MINT_BLOCK + 1, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10}
        )
        output = StringIO()
        with patch("tokens.services.register_snapshot.get_base_chain_client", return_value=self.node.client):
            call_command("register_reconcile", token=self.tenant.token.pk, stdout=output)
        printed = json.loads(output.getvalue())
        self.assertEqual((printed["status"], printed["block"]), ("matched", MINT_BLOCK + 1))
        self.assertEqual(printed["reconciliation"], str(RegisterReconciliation.objects.get().pk))
        with self.assertRaisesRegex(CommandError, "no applied register opening"):
            call_command("register_reconcile", token=register_fixture()[2].pk, stdout=StringIO())


class ScopedRegisterReconciliationTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, _, self.token, _, _, _ = register_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
            self.record = RegisterReconciliation.objects.create(
                token=self.token,
                status="matched",
                block_number=7,
                block_hash="0x" + "ab" * 32,
                register_sequence=1,
            )

    def test_the_issuer_reads_its_reconciliations_and_only_the_operator_records_them(self):
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(list(RegisterReconciliation.objects.values_list("pk", flat=True)), [self.record.pk])
        with self.assertRaises(PermissionDenied):
            reconcile_register(self.token.pk)
        with self.assertRaises(DatabaseError), atomic():
            RegisterReconciliation.objects.create(
                token=self.token, status="matched", block_number=8, block_hash="0x" + "cd" * 32, register_sequence=1
            )
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(RegisterReconciliation.objects.count(), 0)
        self.no_principal_is_set()
        self.assertEqual(RegisterReconciliation.objects.count(), 0)
        with use_operator():
            self.assertEqual(RegisterReconciliation.objects.count(), 1)
