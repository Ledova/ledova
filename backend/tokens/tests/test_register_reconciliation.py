import json
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from integrations.blockchain.receipts import normalized_hash
from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import (
    IssuanceExecutionStatus,
    RegisterAcknowledgement,
    RegisterEntry,
    RegisterReconciliation,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
    SwapOrderStatus,
)
from tokens.services import (
    issuance_execution,
    register_inclusions,
    register_reconciliation,
)
from tokens.services.register import RECONCILED_ROW, export_rows
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction_review,
    submit_correction,
)
from tokens.services.register_reconciliation import (
    acknowledge_discrepancy,
    reconcile_register,
)
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tasks.register_reconciliation import reconcile_every_register
from tokens.tests import test_swap_finality
from tokens.tests.issuance_fixtures import admit
from tokens.tests.test_register_corrections import correction_payload
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
        with patch.object(register_inclusions, "_history", wraps=register_inclusions._history) as parsed:
            record = self.reconcile()
        self.assertEqual(
            (record.status, record.discrepancies, record.block_number, record.register_sequence, record.failure),
            ("matched", [], LATER + 2, 2, ""),
        )
        self.assertEqual(parsed.call_count, 1)
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
        for index in range(len(record.discrepancies)):
            self.acknowledge(record, index)
        self.assertEqual(self.reconcile().status, "matched")

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

    def test_an_issuance_held_for_attribution_does_not_explain_its_transfer(self):
        first = self.opened()
        command = self.admitted(amount=4, block=LATER)
        self.mint_node.receipt_status = 0
        self.mint_node.finalized = LATER - 1
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        attempt = ShareIssuanceExecution.objects.get(pk=command.pk).operation.current_attempt
        self.mint_node.receipts[attempt.tx_hash]["status"] = 1
        self.mint_node.finalized = LATER
        with self.assertLogs("tokens.services.issuance_execution", "WARNING") as held:
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        self.assertIn("attribution is required", held.output[0])
        self.chain(
            LATER + 1,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER, ZERO_ADDRESS, self.recipient, 4, attempt.tx_hash),
            holdings={self.recipient: 14},
        )
        record = self.reconcile()
        self.assertEqual(self.kinds(record), ["member", "supply", "unrecognised_transfer"])
        unrecognised = next(item for item in record.discrepancies if item["kind"] == "unrecognised_transfer")
        self.assertEqual(unrecognised["transaction"], attempt.tx_hash)

    def test_a_superseded_attempt_found_on_chain_is_not_in_flight(self):
        first = self.opened()
        command = self.admitted(amount=4, block=LATER)
        self.mint_node.receipt_status = 0
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "failed")
        superseded = ShareIssuanceExecution.objects.get(pk=command.pk).operation.current_attempt
        admit(ShareIssuanceRequest.objects.get(pk=command.request_id), self.actor)
        self.mint_node.receipt_status = 1
        self.mint_node.finalized = LATER - 1
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        current = ShareIssuanceExecution.objects.get(pk=command.pk).operation.current_attempt
        self.assertNotEqual(current.pk, superseded.pk)
        self.chain(
            LATER + 1,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER - 1, ZERO_ADDRESS, self.recipient, 4, superseded.tx_hash),
            (LATER, ZERO_ADDRESS, self.recipient, 4, current.tx_hash),
            holdings={self.recipient: 18},
        )
        record = self.reconcile()
        self.assertEqual(self.kinds(record), ["member", "supply", "unrecognised_transfer"])
        unrecognised = next(item for item in record.discrepancies if item["kind"] == "unrecognised_transfer")
        self.assertEqual(unrecognised["transaction"], superseded.tx_hash)

    def test_a_completion_held_for_attribution_accounts_for_its_own_transfer(self):
        command = self.admitted(block=LATER)
        self.mint_node.finalized = LATER - 1
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        execution = ShareIssuanceExecution.objects.get(pk=command.pk)
        tx_hash = execution.transaction.tx_hash
        self.open_at(
            LATER - 2,
            holdings={self.recipient: 10},
            transfers=[(MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, tx_hash)],
            mapping=[{"address": self.recipient, "member": str(uuid4())}],
        )
        self.mint_node.finalized = LATER
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        self.chain(LATER + 1, (LATER, ZERO_ADDRESS, self.recipient, 10, tx_hash), holdings={self.recipient: 10})
        record = self.reconcile()
        self.assertEqual(self.kinds(record), ["attribution"])
        self.assertEqual(record.discrepancies[0]["source"], str(execution.issuance_id))

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

    def test_a_completed_effect_in_a_replaced_block_is_missing_even_at_its_height(self):
        first = self.opened()
        later = self.mint(block=LATER)
        self.chain(
            LATER + 1,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER, ZERO_ADDRESS, self.recipient, 10, later.tx_hash),
            holdings={self.recipient: 20},
        )
        self.node.blocks[LATER]["hash"] = self.node.events[1]["blockHash"] = block_hash(777)
        record = self.reconcile()
        self.assertEqual(self.kinds(record), ["missing_transfer", "unrecognised_transfer"])
        unrecognised = next(item for item in record.discrepancies if item["kind"] == "unrecognised_transfer")
        self.assertEqual((unrecognised["transaction"], unrecognised["block"]), (later.tx_hash.lower(), LATER))

    def test_an_unreadable_chain_is_a_failed_reconciliation_not_a_register_failure(self):
        self.opened()
        self.node.client.assert_expected_chain.return_value = 999
        with self.assertLogs("tokens.services.register_reconciliation", "WARNING"):
            record = self.reconcile()
        self.assertEqual((record.status, record.block_number, record.discrepancies), ("failed", None, []))
        self.assertIn("original deployment chain", record.failure)
        summary = [row for row in export_rows(self.tenant.token, self.owner) if row and row[0] == RECONCILED_ROW]
        self.assertEqual(summary[0][:3], [RECONCILED_ROW, "failed", ""])

    def test_a_snapshot_below_the_opening_boundary_is_a_failed_reconciliation(self):
        first = self.mint()
        minted = (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash)
        moved = (LATER - 1, self.recipient, BOB, 3, None)
        self.open_at(
            LATER,
            holdings={self.recipient: 7, BOB: 3},
            transfers=[minted, moved],
            mapping=[{"address": self.recipient, "member": str(uuid4())}, {"address": BOB, "member": str(uuid4())}],
        )
        self.chain(LATER - 2, minted, holdings={self.recipient: 10})
        with self.assertLogs("tokens.services.register_reconciliation", "WARNING"):
            record = self.reconcile()
        self.assertEqual((record.status, record.block_number, record.discrepancies), ("failed", None, []))
        self.assertEqual(
            record.failure,
            register_reconciliation.BELOW_OPENING.format(snapshot=LATER - 2, boundary=LATER),
        )
        self.chain(LATER, minted, moved, holdings={self.recipient: 7, BOB: 3})
        self.assertEqual(self.reconcile().status, "matched")

    def test_the_stored_register_is_locked_while_it_is_compared(self):
        first = self.opened()
        self.chain(
            MINT_BLOCK + 1, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10}
        )
        register = ShareRegister.objects.get(token=self.tenant.token)
        probe = connections[current_alias()].copy(alias="reconciliation-lock-probe")
        self.addCleanup(probe.close)
        recorded = register_reconciliation._recorded
        observed = []

        def lockable():
            with probe.cursor() as cursor:
                try:
                    cursor.execute(
                        "SELECT uuid FROM tokens_shareregister WHERE uuid = %s FOR UPDATE NOWAIT", [register.pk]
                    )
                except DatabaseError:
                    return False
                return cursor.fetchall() == [(register.pk,)]

        def probed(token_id):
            observed.append(lockable())
            return recorded(token_id)

        with patch.object(register_reconciliation, "_recorded", side_effect=probed):
            self.assertEqual(self.reconcile().status, "matched")
        self.assertEqual(observed, [False])
        self.assertTrue(lockable())

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

    def test_the_task_reconciles_every_opened_share_class_and_fails_when_one_could_not_be_reconciled(self):
        first = self.opened()
        self.chain(
            MINT_BLOCK + 1, (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash), holdings={self.recipient: 10}
        )
        with patch("tokens.services.register_snapshot.get_base_chain_client", return_value=self.node.client):
            self.assertEqual(reconcile_every_register(), {"matched": 1, "discrepant": 0, "failed": 0})
            with (
                patch("tokens.tasks.register_reconciliation.reconcile_register", side_effect=RuntimeError("boom")),
                self.assertLogs("tokens.tasks.register_reconciliation", "ERROR"),
                self.assertRaisesMessage(RuntimeError, "Register reconciliation failed for 1 share classes."),
            ):
                reconcile_every_register()
            self.assertEqual(RegisterReconciliation.objects.count(), 1)
            self.node.client.assert_expected_chain.return_value = 999
            with (
                self.assertLogs("tokens.services.register_reconciliation", "WARNING"),
                self.assertRaisesMessage(RuntimeError, "Register reconciliation failed for 1 share classes."),
            ):
                reconcile_every_register()
        self.assertEqual(RegisterReconciliation.objects.first().status, "failed")

    def test_a_transfer_of_no_shares_is_not_a_discrepancy(self):
        first = self.opened()
        self.chain(
            LATER,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER - 1, BOB, ZERO_ADDRESS, 0, None),
            holdings={self.recipient: 10, BOB: 0},
        )
        self.assertEqual(self.reconcile().status, "matched")

    def two_members(self):
        first = self.mint()
        self.minted = (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash)
        self.moved = (LATER - 1, self.recipient, BOB, 3, None)
        self.members = str(uuid4()), str(uuid4())
        self.open_at(
            LATER,
            holdings={self.recipient: 7, BOB: 3},
            transfers=[self.minted, self.moved],
            mapping=[
                {"address": self.recipient, "member": self.members[0]},
                {"address": BOB, "member": self.members[1]},
            ],
        )

    def acknowledge(self, record, index, reason="Accepted by the directors"):
        return acknowledge_discrepancy(reconciliation_id=record.pk, index=index, reason=reason, actor=self.reviewer)

    def outcome(self, record):
        return sorted(
            (item["kind"], item.get("member", item.get("transaction")), item.get("chain"), item.get("expected"))
            for item in record.discrepancies
        )

    def test_acknowledged_discrepancies_are_explained_and_a_later_divergence_still_surfaces(self):
        self.two_members()
        outside = (LATER + 1, self.recipient, BOB, 2, None)
        self.chain(LATER + 2, self.minted, self.moved, outside, holdings={self.recipient: 5, BOB: 5})
        record = self.reconcile()
        self.assertEqual(
            self.outcome(record),
            sorted(
                [
                    ("member", self.members[0], "5", "7"),
                    ("member", self.members[1], "5", "3"),
                    ("unrecognised_transfer", block_hash(100 + LATER + 1), None, None),
                ]
            ),
        )
        for index in range(len(record.discrepancies)):
            self.acknowledge(record, index)
        self.assertEqual(self.reconcile().status, "matched")
        again = (LATER + 3, BOB, self.recipient, 1, None)
        self.chain(LATER + 4, self.minted, self.moved, outside, again, holdings={self.recipient: 6, BOB: 4})
        self.assertEqual(
            self.outcome(self.reconcile()),
            sorted(
                [
                    ("member", self.members[0], "6", "5"),
                    ("member", self.members[1], "4", "5"),
                    ("unrecognised_transfer", block_hash(100 + LATER + 3), None, None),
                ]
            ),
        )

    def test_an_applied_correction_is_acknowledged_like_any_other_difference(self):
        first = self.opened()
        later = self.mint(block=LATER)
        issue = RegisterEntry.objects.get(operation_id=later.pk, kind="issue")
        proposal = submit_correction(actor=self.owner, **correction_payload(self.document, issue))
        _, confirmation = prepare_correction_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        decided = decide_correction(
            proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
        )
        self.assertEqual(decided.status, "applied")
        self.chain(
            LATER + 1,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER, ZERO_ADDRESS, self.recipient, 10, later.tx_hash),
            holdings={self.recipient: 20},
        )
        record = self.reconcile()
        self.assertEqual(
            [(item["kind"], item["chain"], item["expected"]) for item in record.discrepancies],
            [("member", "20", "10"), ("supply", "20", "10")],
        )
        self.acknowledge(record, 1, reason="The duplicate allotment was corrected by resolution")
        self.assertEqual(self.kinds(self.reconcile()), ["member"])
        self.acknowledge(RegisterReconciliation.objects.first(), 0)
        self.assertEqual(self.reconcile().status, "matched")

    def test_acknowledgements_are_retained_as_recorded_and_refused_unless_exact(self):
        first = self.opened()
        self.chain(
            LATER,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER - 1, ZERO_ADDRESS, self.recipient, 5, None),
            holdings={self.recipient: 15},
        )
        record = self.reconcile()
        rows = {item["kind"]: item for item in record.discrepancies}
        valid = {
            "token_id": self.tenant.token.pk,
            "reconciliation": record,
            "discrepancy": rows["member"],
            "reason": "Accepted by the directors",
            "acknowledged_by_id": self.reviewer.pk,
        }
        acknowledgement = RegisterAcknowledgement.objects.create(**valid)
        with self.assertRaises(DatabaseError), atomic():
            RegisterAcknowledgement.objects.filter(pk=acknowledgement.pk).update(reason="Rewritten")
        with self.assertRaises(DatabaseError), atomic():
            acknowledgement.delete()
        clerk = get_user_model().objects.create_user(email=f"clerk-{uuid4()}@example.test", is_active=True)
        for changes in (
            {},
            {"discrepancy": {**rows["supply"], "chain": "16"}},
            {"discrepancy": rows["supply"], "reason": " "},
            {"discrepancy": rows["supply"], "acknowledged_by_id": clerk.pk},
            {"discrepancy": rows["supply"], "token_id": register_fixture()[2].pk},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                RegisterAcknowledgement.objects.create(**{**valid, **changes})
        RegisterAcknowledgement.objects.create(**{**valid, "discrepancy": rows["supply"]})
        held = RegisterReconciliation.objects.create(
            token=self.tenant.token,
            status="discrepant",
            block_number=LATER,
            block_hash=block_hash(LATER),
            register_sequence=1,
            discrepancies=[
                {"kind": "attribution", "effect": "issue", "source": str(first.pk)},
                {"kind": "missing_transfer", "effect": "issue", "source": str(first.pk), "transaction": first.tx_hash},
            ],
        )
        for row in held.discrepancies:
            with self.subTest(row=row), self.assertRaises(DatabaseError), atomic():
                RegisterAcknowledgement.objects.create(**{**valid, "reconciliation": held, "discrepancy": row})
        self.assertEqual(RegisterAcknowledgement.objects.count(), 2)

    def test_the_acknowledge_command_records_one_discrepancy_and_refuses_what_it_cannot(self):
        first = self.opened()
        self.chain(
            LATER,
            (MINT_BLOCK, ZERO_ADDRESS, self.recipient, 10, first.tx_hash),
            (LATER - 1, ZERO_ADDRESS, self.recipient, 5, None),
            holdings={self.recipient: 15},
        )
        record = self.reconcile()
        supply = [item["kind"] for item in record.discrepancies].index("supply")
        arguments = {
            "reconciliation": record.pk,
            "discrepancy": supply,
            "reason": "Accepted by the directors",
            "actor": self.reviewer.pk,
        }
        clerk = get_user_model().objects.create_user(email=f"clerk-{uuid4()}@example.test", is_active=True)
        for changes, refusal in (
            ({"reason": " "}, "reason"),
            ({"actor": clerk.pk}, "active staff"),
            ({"discrepancy": 3}, "position"),
            ({"reconciliation": uuid4()}, "not found"),
        ):
            with self.subTest(changes=changes), self.assertRaisesRegex(CommandError, refusal):
                call_command("register_acknowledge", **{**arguments, **changes}, stdout=StringIO())
        with self.assertRaisesRegex(CommandError, "--reason"):
            call_command("register_acknowledge", reconciliation=record.pk, discrepancy=supply, actor=self.reviewer.pk)
        self.assertFalse(RegisterAcknowledgement.objects.exists())
        output = StringIO()
        call_command("register_acknowledge", **arguments, stdout=output)
        printed = json.loads(output.getvalue())
        self.assertEqual(
            (printed["acknowledgement"], printed["discrepancy"], printed["reason"]),
            (str(RegisterAcknowledgement.objects.get().pk), record.discrepancies[supply], arguments["reason"]),
        )
        with self.assertRaisesRegex(CommandError, "already acknowledged"):
            call_command("register_acknowledge", **arguments, stdout=StringIO())
        self.reconcile()
        with self.assertRaisesRegex(CommandError, "latest reconciliation"):
            call_command("register_acknowledge", **{**arguments, "discrepancy": 0}, stdout=StringIO())
        held = RegisterReconciliation.objects.create(
            token=self.tenant.token,
            status="discrepant",
            block_number=LATER,
            block_hash=block_hash(LATER),
            register_sequence=1,
            discrepancies=[{"kind": "attribution", "effect": "issue", "source": str(first.pk)}],
        )
        with self.assertRaisesRegex(CommandError, "needs attribution"):
            call_command("register_acknowledge", **{**arguments, "reconciliation": held.pk, "discrepancy": 0})
        self.assertEqual(RegisterAcknowledgement.objects.count(), 1)

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


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=test_swap_finality.KEY,
    BLOCKCHAIN_CHAIN_ID=test_swap_finality.CHAIN_ID,
    ATOMIC_SWAP_ADDRESS=test_swap_finality.CONTRACT,
)
class InFlightSettlementTest(test_swap_finality.SwapFinalityFixtures, TransactionTestCase):
    def in_flight(self):
        with use_operator():
            return register_reconciliation._in_flight(self.swap.share_token, [normalized_hash(self.record.tx_hash)])

    def test_only_a_settlement_still_executing_explains_its_transfer(self):
        self.confirm()
        amount = self.swap.share_amount
        self.assertEqual(
            self.in_flight(),
            {
                normalized_hash(self.record.tx_hash): (
                    [(self.swap.seller_address, -amount), (self.swap.buyer_address, amount)],
                    0,
                )
            },
        )
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=test_swap_finality.FINALIZED):
            self.node.advance(head=20, finalized=12)
            self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)
        self.assertEqual(self.in_flight(), {})

    def test_a_settlement_held_for_attribution_does_not_explain_its_transfer(self):
        self.flip(0)
        with (
            override_settings(WALLET_CHAIN_FINALITY_POLICIES=test_swap_finality.FINALIZED),
            self.assertLogs(test_swap_finality.LOGGER, "WARNING") as held,
        ):
            self.assertIsNone(self.settle())
        self.assertIn("held for operator attribution", held.output[0])
        self.assertEqual(self.swap.status, SwapOrderStatus.EXECUTING)
        self.assertEqual(self.in_flight(), {})


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
        with self.assertRaises(PermissionDenied):
            acknowledge_discrepancy(reconciliation_id=self.record.pk, index=0, reason="Accepted", actor=self.owner)
        with self.assertRaises(DatabaseError), atomic():
            RegisterAcknowledgement.objects.exists()
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(RegisterReconciliation.objects.count(), 0)
        self.no_principal_is_set()
        self.assertEqual(RegisterReconciliation.objects.count(), 0)
        with use_operator():
            self.assertEqual(RegisterReconciliation.objects.count(), 1)
            self.assertFalse(RegisterAcknowledgement.objects.exists())
