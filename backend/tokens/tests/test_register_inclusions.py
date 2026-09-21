import json
from contextlib import contextmanager
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from blockchain.models import TransactionStatus
from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from integrations.blockchain.receipts import normalized_hash
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import (
    IssuanceExecutionStatus,
    IssuanceStatus,
    RegisterEntry,
    RegisterEntryKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution, register_inclusions, register_openings
from tokens.services.register_events import record_entry
from tokens.services.register_inclusions import (
    AFTER_OPENING,
    ATTRIBUTION,
    OPENING,
    UNOPENED,
    chain_order,
    classified_inclusions,
    classify_inclusion,
    completed_inclusions,
    opening_boundary,
    record_completed_effects,
    unrepresented_inclusions,
    waiting_effects,
)
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
    submit_opening,
)
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tests.instruction_fixtures import apply_instruction
from tokens.tests.issuance_fixtures import CHAIN_ID, IssuanceNode, admit
from tokens.tests.test_register_openings import (
    ALICE,
    BOB,
    SETTINGS,
    opening_fixture,
    opening_payload,
)
from tokens.tests.test_register_snapshot import block_hash, transfer

MINT_BLOCK = 12


class InclusionFixtures:
    def setUp(self):
        self.tenant, self.owner, self.reviewer, self.document, self.target, self.node = opening_fixture()
        self.actor = self.reviewer
        self.actor.is_superuser = True
        self.actor.save(update_fields=["is_superuser"])
        self.recipient = self.tenant.wallet.address
        self.mint_node = IssuanceNode()
        for target, value in (
            ("tokens.services.issuance_execution.get_base_chain_client", self.mint_node.client),
            ("tokens.services.share_token_service.is_recipient_whitelisted", True),
        ):
            self.enterContext(patch(target, return_value=value))
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))

    def payload(self, **changes):
        return {**opening_payload(self.document, self.target), **changes}

    def mint(self, *, block=MINT_BLOCK, **terms):
        command = self.admitted(block=block, **terms)
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        command.refresh_from_db()
        return ShareIssuance.objects.get(pk=command.issuance_id)

    def admitted(self, *, amount=10, block=MINT_BLOCK, recipient=None, index=None, reviewer=None, instructed=True):
        request = ShareIssuanceRequest.objects.create(
            token=self.tenant.token, recipient_address=recipient or self.recipient, amount=amount, reason="Allotment"
        )
        if instructed:
            apply_instruction(self.tenant.token, request, reviewer=reviewer or self.actor, document=self.document)
            request.refresh_from_db()
        else:
            request.approve(reviewer or self.actor)
        command = admit(request, self.actor)
        self.mint_node.head = self.mint_node.finalized = block
        if block != MINT_BLOCK or index is not None:
            original = self.mint_node.send

            def send(raw):
                tx_hash = original(raw)
                self.mint_node.receipts[tx_hash] = {
                    **self.mint_node.receipts[tx_hash],
                    **({"blockNumber": block, "blockHash": block_hash(block)} if block != MINT_BLOCK else {}),
                    **({} if index is None else {"transactionIndex": index}),
                }
                return tx_hash

            self.mint_node.client.send_raw_transaction.side_effect = send
        return command

    def boundary_at(self, height, *, holdings, transfers):
        self.node.finalized = height
        self.node.blocks = {
            number: {
                "number": number,
                "hash": self.target.deployment_hash if number == self.target.deployment_block else block_hash(number),
                "timestamp": 1_789_862_400 + number,
            }
            for number in range(self.target.deployment_block, height + 1)
        }
        self.node.events = [
            {
                **transfer(number, sender, recipient, shares),
                "blockHash": self.node.blocks[number]["hash"],
                **({"transactionHash": transaction} if transaction else {}),
            }
            for number, sender, recipient, shares, transaction in transfers
        ]
        self.node.balances = dict(holdings)
        self.node.contract.functions.totalSupply.return_value.call.return_value = sum(holdings.values())

    def open_at(self, height, *, holdings, transfers, mapping):
        self.boundary_at(height, holdings=holdings, transfers=transfers)
        proposal = submit_opening(actor=self.owner, **self.payload(mapping=mapping))
        confirmation = prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)[
            1
        ]
        self.applied_confirmation = confirmation
        return self.decide(proposal, confirmation)

    def decide(self, proposal, confirmation):
        return decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            client=self.node.client,
        )

    def open_holding_the_mint(self, issuance):
        height = self.target.deployment_block
        return self.open_at(
            height,
            holdings={self.recipient: 10},
            transfers=[(height, ZERO_ADDRESS, self.recipient, 10, issuance.tx_hash)],
            mapping=[{"address": self.recipient, "member": str(uuid4())}],
        )

    @contextmanager
    def before_history(self):
        capture = register_openings.capture_snapshot
        self.addCleanup(restore_every_migration)
        migrate_to([("tokens", "0065_register_opening")])
        with (
            patch.object(
                register_openings,
                "capture_snapshot",
                side_effect=lambda *args, **kwargs: {
                    key: value for key, value in capture(*args, **kwargs).items() if key != "history"
                },
            ),
            patch.object(register_openings, "assert_boundary_represents_completions"),
        ):
            yield
        restore_every_migration()

    def review_before_history(self):
        with self.before_history():
            proposal = submit_opening(actor=self.owner, **self.payload())
            proposal, confirmation = prepare_opening_review(
                proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client
            )
        self.assertNotIn("history", RegisterOpening.objects.get(pk=proposal.pk).boundary)
        return proposal, confirmation


@override_settings(**SETTINGS)
class RegisterInclusionTest(InclusionFixtures, TransactionTestCase):
    def test_an_unopened_register_leaves_completed_inclusions_unrepresented(self):
        issuance = self.mint()
        self.assertIsNone(opening_boundary(self.tenant.token.pk))
        inclusions = completed_inclusions(self.tenant.token.pk)
        self.assertEqual(
            inclusions,
            [
                {
                    "kind": "issue",
                    "source": str(issuance.pk),
                    "transaction": normalized_hash(issuance.tx_hash),
                    "block_number": MINT_BLOCK,
                    "block_hash": normalized_hash(BLOCK_HASH),
                    "transaction_index": None,
                }
            ],
        )
        self.assertEqual(classify_inclusion(None, inclusions[0]), UNOPENED)
        report = classified_inclusions(self.tenant.token.pk)
        self.assertIsNone(report["boundary"])
        self.assertEqual(report["inclusions"], [{**inclusions[0], "classification": UNOPENED, "recorded": False}])

    def test_an_inclusion_in_the_boundary_block_is_represented_and_a_later_block_is_not(self):
        issuance = self.mint()
        applied = self.open_holding_the_mint(issuance)
        boundary = applied.boundary
        self.assertEqual(boundary["block"]["number"], MINT_BLOCK)
        inclusion = completed_inclusions(self.tenant.token.pk)[0]
        self.assertEqual(inclusion["source"], str(issuance.pk))
        self.assertEqual(classify_inclusion(boundary, inclusion), OPENING)
        self.assertEqual(unrepresented_inclusions(self.tenant.token.pk, boundary), [])
        later = {
            **inclusion,
            "transaction": normalized_hash(block_hash(99)),
            "block_number": MINT_BLOCK + 1,
            "block_hash": normalized_hash(block_hash(MINT_BLOCK + 1)),
        }
        self.assertEqual(classify_inclusion(boundary, later), AFTER_OPENING)
        self.assertEqual(classify_inclusion({**boundary, "history": []}, inclusion), ATTRIBUTION)
        self.assertEqual(
            classify_inclusion({key: value for key, value in boundary.items() if key != "history"}, inclusion),
            ATTRIBUTION,
        )
        self.assertEqual(
            classified_inclusions(self.tenant.token.pk)["inclusions"],
            [{**inclusion, "classification": OPENING, "recorded": False}],
        )
        later = self.mint(block=MINT_BLOCK + 4)
        repeated = self.decide(applied, self.applied_confirmation)
        self.assertEqual((repeated.pk, repeated.status), (applied.pk, "applied"))
        self.assertEqual(
            list(RegisterEntry.objects.order_by("sequence").values_list("kind", "operation_id")),
            [("opening", applied.pk), ("issue", later.pk)],
        )
        rows = {row["source"]: row for row in classified_inclusions(self.tenant.token.pk)["inclusions"]}
        self.assertEqual(
            {source: (row["classification"], row["recorded"]) for source, row in rows.items()},
            {str(issuance.pk): (OPENING, False), str(later.pk): (AFTER_OPENING, True)},
        )

    def test_a_read_and_a_recording_pass_parse_the_boundary_history_once(self):
        self.open_holding_the_mint(self.mint())
        self.mint(block=MINT_BLOCK + 2)
        self.mint(block=MINT_BLOCK + 3)
        with patch.object(register_inclusions, "_history", wraps=register_inclusions._history) as parsed:
            rows = classified_inclusions(self.tenant.token.pk)["inclusions"]
            record_completed_effects(self.tenant.token.pk)
        self.assertEqual([row["classification"] for row in rows], [OPENING, AFTER_OPENING, AFTER_OPENING])
        self.assertEqual(parsed.call_count, 2)

    def test_completion_evidence_keeps_the_transaction_index_that_orders_a_block(self):
        issuance = self.mint(index=3)
        execution = ShareIssuanceExecution.objects.get(issuance_id=issuance.pk)
        self.assertEqual(execution.finalized_receipt["transaction_index"], 3)
        self.assertEqual(completed_inclusions(self.tenant.token.pk)[0]["transaction_index"], 3)
        issue = {"kind": "issue", "source": "f" * 8, "block_number": 20, "transaction_index": 1}
        transfer = {"kind": "transfer", "source": "0" * 8, "block_number": 20, "transaction_index": 0}
        unindexed = {"kind": "issue", "source": "0" * 8, "block_number": 20, "transaction_index": None}
        earlier = {"kind": "transfer", "source": "f" * 8, "block_number": 19, "transaction_index": 9}
        self.assertEqual(
            sorted([issue, unindexed, transfer, earlier], key=chain_order), [earlier, transfer, issue, unindexed]
        )

    def test_an_unrelated_entry_reusing_a_completion_id_does_not_mark_it_recorded(self):
        first = self.mint()
        applied = self.open_holding_the_mint(first)
        waiting = self.mint(block=MINT_BLOCK + 4, recipient=ALICE)
        member = applied.applied_entry.changes[0]["member"]
        register_id = applied.applied_entry.register_id
        earlier = record_entry(
            register_id=register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": member, "shares": "5"}],
            effective_on=applied.applied_entry.effective_on,
            recorded_by=self.reviewer,
        )
        record_entry(
            register_id=register_id,
            operation_id=waiting.pk,
            kind=RegisterEntryKind.CORRECTION,
            changes=[{"member": member, "shares": "-5"}],
            effective_on=applied.applied_entry.effective_on,
            recorded_by=self.reviewer,
            corrects_id=earlier.pk,
        )
        RegisterMemberWallet.objects.create(company=self.tenant.company, member_id=member, address=ALICE)
        with self.assertLogs("tokens.services.register_inclusions", "WARNING"):
            self.assertEqual(record_completed_effects(self.tenant.token.pk), [])
        rows = {row["source"]: row for row in classified_inclusions(self.tenant.token.pk)["inclusions"]}
        self.assertFalse(rows[str(waiting.pk)]["recorded"])
        self.assertFalse(RegisterEntry.objects.filter(operation_id=waiting.pk, kind=RegisterEntryKind.ISSUE).exists())

    def test_the_boundary_height_reached_through_another_block_is_held_for_attribution(self):
        issuance = self.mint()
        applied = self.open_holding_the_mint(issuance)
        inclusion = completed_inclusions(self.tenant.token.pk)[0]
        reorganised = {**inclusion, "block_hash": normalized_hash(block_hash(MINT_BLOCK))}
        self.assertNotEqual(reorganised["block_hash"], normalized_hash(applied.boundary["block"]["hash"]))
        self.assertEqual(classify_inclusion(applied.boundary, reorganised), ATTRIBUTION)
        forked = {
            **applied.boundary,
            "history": [{**entry, "block_hash": block_hash(MINT_BLOCK)} for entry in applied.boundary["history"]],
        }
        self.assertEqual(classify_inclusion(forked, reorganised), ATTRIBUTION)
        recorded = {**inclusion, "transaction": normalized_hash(block_hash(98)), "block_number": MINT_BLOCK - 1}
        self.assertEqual(classify_inclusion(applied.boundary, recorded), ATTRIBUTION)

    def test_an_issuance_completed_after_the_captured_boundary_refuses_until_a_fresh_boundary_covers_it(self):
        later = self.target.deployment_block + 8
        proposal = submit_opening(actor=self.owner, **self.payload())
        confirmation = prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)[
            1
        ]
        captured = RegisterOpening.objects.get(pk=proposal.pk).boundary["block"]["number"]
        issuance = self.mint(block=later)
        self.assertGreater(later, captured)
        with self.assertRaises(ValidationError) as refused:
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        self.assertIn(str(issuance.pk), str(refused.exception.detail))
        self.assertIn(str(later), str(refused.exception.detail))
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterEntry.objects.exists())
        with self.assertRaises(ValidationError):
            prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)
        fresh = self.open_at(
            later + 2,
            holdings={ALICE: 80, BOB: 20, self.recipient: 10},
            transfers=[
                (self.target.deployment_block + 1, ZERO_ADDRESS, ALICE, 100, None),
                (self.target.deployment_block + 2, ALICE, BOB, 20, None),
                (later, ZERO_ADDRESS, self.recipient, 10, issuance.tx_hash),
            ],
            mapping=[
                {"address": ALICE, "member": str(uuid4())},
                {"address": BOB, "member": str(uuid4())},
                {"address": self.recipient, "member": str(uuid4())},
            ],
        )
        self.assertEqual((fresh.status, fresh.boundary["block"]["number"]), ("applied", later + 2))
        inclusion = completed_inclusions(self.tenant.token.pk)[0]
        self.assertEqual(classify_inclusion(fresh.boundary, inclusion), OPENING)
        self.assertEqual(unrepresented_inclusions(self.tenant.token.pk, fresh.boundary), [])

    def test_a_completed_issuance_without_verified_final_inclusion_is_refused_not_assumed_covered(self):
        legacy = ShareIssuance.objects.create(
            token=self.tenant.token,
            recipient_address=self.recipient,
            amount="10",
            status=IssuanceStatus.COMPLETED,
            block_number=self.target.deployment_block,
        )
        with self.assertRaises(ValidationError) as refused:
            completed_inclusions(self.tenant.token.pk)
        self.assertIn(str(legacy.pk), str(refused.exception.detail))
        proposal = submit_opening(actor=self.owner, **self.payload())
        with self.assertRaises(ValidationError):
            prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)
        self.assertFalse(RegisterEntry.objects.exists())

    def test_a_completion_without_verified_inclusion_makes_the_waiting_count_unknown(self):
        self.open_holding_the_mint(self.mint())
        self.assertEqual(waiting_effects(self.tenant.token.pk), 0)
        ShareIssuance.objects.create(
            token=self.tenant.token,
            recipient_address=self.recipient,
            amount="10",
            status=IssuanceStatus.COMPLETED,
            block_number=MINT_BLOCK + 2,
        )
        self.assertIsNone(waiting_effects(self.tenant.token.pk))

    def test_a_first_receipt_completion_recorded_before_finality_is_refused(self):
        request = ShareIssuanceRequest.objects.create(
            token=self.tenant.token, recipient_address=self.recipient, amount=10, reason="Historical allotment"
        )
        request.approve(self.actor)
        command = admit(request, self.actor)
        self.mint_node.finalized = MINT_BLOCK - 1
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        command.refresh_from_db()
        self.assertEqual((command.status, command.transaction.status), ("executing", TransactionStatus.CONFIRMED))
        self.addCleanup(restore_every_migration)
        previous = migrate_to([("tokens", "0065_register_opening")])
        previous.get_model("tokens", "ShareIssuanceExecution").objects.filter(pk=command.pk).update(status="executed")
        previous.get_model("tokens", "ShareIssuance").objects.filter(pk=command.issuance_id).update(
            status="completed", completed_at=timezone.now()
        )
        restore_every_migration()
        historical = ShareIssuanceExecution.objects.select_related("transaction").get(pk=command.pk)
        self.assertEqual(historical.status, IssuanceExecutionStatus.EXECUTED)
        self.assertIsNone(historical.finalized_receipt)
        self.assertEqual(
            (historical.transaction.status, historical.transaction.block_number),
            (TransactionStatus.CONFIRMED, MINT_BLOCK),
        )
        self.assertTrue(historical.transaction.block_hash)
        with self.assertRaises(ValidationError) as refused:
            completed_inclusions(self.tenant.token.pk)
        self.assertIn(str(command.issuance_id), str(refused.exception.detail))
        proposal = submit_opening(actor=self.owner, **self.payload())
        with self.assertRaises(ValidationError):
            prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)
        self.assertFalse(RegisterEntry.objects.exists())

    def test_an_orphaned_earlier_inclusion_is_held_for_attribution_and_refuses_the_opening(self):
        self.enterContext(
            override_settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 1}})
        )
        issuance = self.mint(block=self.target.deployment_block + 2)
        boundary_height = self.target.deployment_block + 4
        self.boundary_at(
            boundary_height,
            holdings={ALICE: 100},
            transfers=[(self.target.deployment_block, ZERO_ADDRESS, ALICE, 100, None)],
        )
        self.node.latest = boundary_height
        self.node.blocks[self.target.deployment_block + 2]["hash"] = block_hash(777)
        proposal = submit_opening(
            actor=self.owner, **self.payload(mapping=[{"address": ALICE, "member": str(uuid4())}])
        )
        with self.assertRaises(ValidationError) as refused:
            prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)
        self.assertIn(str(issuance.pk), str(refused.exception.detail))
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterEntry.objects.exists())
        captured = RegisterOpening.objects.get(pk=proposal.pk).boundary
        self.assertEqual(captured["block"]["number"], boundary_height)
        inclusion = completed_inclusions(self.tenant.token.pk)[0]
        self.assertLess(inclusion["block_number"], boundary_height)
        self.assertEqual(classify_inclusion(captured, inclusion), ATTRIBUTION)
        self.assertEqual(unrepresented_inclusions(self.tenant.token.pk, captured), [inclusion])

    def test_a_boundary_without_valid_history_holds_even_a_later_completion_for_attribution(self):
        issuance = self.mint()
        boundary = self.open_holding_the_mint(issuance).boundary
        (recorded,) = boundary["history"]
        later = {
            **completed_inclusions(self.tenant.token.pk)[0],
            "transaction": normalized_hash(block_hash(99)),
            "block_number": MINT_BLOCK + 1,
            "block_hash": normalized_hash(block_hash(MINT_BLOCK + 1)),
        }
        self.assertEqual(classify_inclusion(boundary, later), AFTER_OPENING)
        self.assertEqual(classify_inclusion({**boundary, "history": []}, later), AFTER_OPENING)
        absent = {key: value for key, value in boundary.items() if key != "history"}
        self.assertEqual(classify_inclusion(absent, later), ATTRIBUTION)
        for history in (
            None,
            {},
            [None],
            [{**recorded, "block": str(recorded["block"])}],
            [{**recorded, "transaction": recorded["transaction"][:-2]}],
            [{**recorded, "observed": True}],
            [recorded, {"block": recorded["block"], "block_hash": recorded["block_hash"]}],
            [{**recorded, "block_hash": block_hash(777)}],
        ):
            with self.subTest(history=history):
                self.assertEqual(classify_inclusion({**boundary, "history": history}, later), ATTRIBUTION)

    def test_an_opening_applied_before_history_was_retained_holds_a_reincluded_mint_for_attribution(self):
        self.enterContext(
            override_settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 3}})
        )
        request = ShareIssuanceRequest.objects.create(
            token=self.tenant.token, recipient_address=self.recipient, amount=10, reason="Allotment"
        )
        request.approve(self.actor)
        command = admit(request, self.actor)
        original = self.mint_node.send

        def send(raw):
            tx_hash = original(raw)
            self.mint_node.receipts[tx_hash].update(blockNumber=14, blockHash=block_hash(14))
            return tx_hash

        self.mint_node.client.send_raw_transaction.side_effect = send
        self.mint_node.head, self.mint_node.finalized = 14, 13
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        command.refresh_from_db()
        tx_hash = command.transaction.tx_hash
        self.node.latest = 18
        with self.before_history():
            applied = self.open_at(
                18,
                holdings={self.recipient: 10},
                transfers=[(14, ZERO_ADDRESS, self.recipient, 10, tx_hash)],
                mapping=[{"address": self.recipient, "member": str(uuid4())}],
            )
        self.assertEqual((applied.status, applied.boundary["block"]["number"]), ("applied", 16))
        self.assertNotIn("history", applied.boundary)
        self.mint_node.block_hashes.update({14: block_hash(777), 18: block_hash(18)})
        self.mint_node.receipts[tx_hash].update(blockNumber=18, blockHash=block_hash(18))
        self.mint_node.head, self.mint_node.finalized = 20, 18
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        inclusion = completed_inclusions(self.tenant.token.pk)[0]
        self.assertEqual(inclusion["block_number"], 18)
        self.assertEqual(
            classified_inclusions(self.tenant.token.pk)["inclusions"],
            [{**inclusion, "classification": ATTRIBUTION, "recorded": False}],
        )
        with self.assertRaisesMessage(ValidationError, "already has a stored register"):
            submit_opening(actor=self.owner, **self.payload())
        repeated = self.decide(applied, self.applied_confirmation)
        self.assertEqual((repeated.pk, repeated.status, repeated.boundary), (applied.pk, "applied", applied.boundary))
        self.assertEqual(RegisterEntry.objects.count(), 1)

    def test_a_pending_opening_captured_before_history_was_retained_can_only_be_rejected(self):
        proposal, confirmation = self.review_before_history()
        with self.assertRaisesMessage(ValidationError, "no canonical transfer history"):
            prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)
        with self.assertRaisesMessage(ValidationError, "no canonical transfer history"):
            self.decide(proposal, confirmation)
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterEntry.objects.exists())
        rejection = {
            "proposal_id": proposal.pk,
            "reviewer": self.reviewer,
            "confirmation": "",
            "decision": "reject",
            "rejection_reason": "Captured before canonical history was retained",
            "client": self.node.client,
        }
        self.assertEqual(decide_opening(**rejection).status, "rejected")
        self.assertEqual(decide_opening(**rejection).status, "rejected")
        fresh = submit_opening(actor=self.owner, **self.payload())
        fresh, fresh_confirmation = prepare_opening_review(
            proposal_id=fresh.pk, reviewer=self.reviewer, client=self.node.client
        )
        self.assertEqual(len(fresh.boundary["history"]), 2)
        self.assertEqual(self.decide(fresh, fresh_confirmation).status, "applied")

    def test_postgresql_refuses_to_apply_a_boundary_captured_without_history(self):
        proposal, confirmation = self.review_before_history()
        with (
            patch.object(register_openings, "assert_boundary_represents_completions"),
            self.assertRaisesMessage(IntegrityError, "requires its canonical transfer history"),
        ):
            self.decide(proposal, confirmation)
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterEntry.objects.exists())
        self.assertFalse(RegisterMember.objects.exists())

    def test_an_unknown_share_class_is_refused_rather_than_reported_empty(self):
        with self.assertRaises(NotFound):
            classified_inclusions(uuid4())

    def test_the_command_reports_the_boundary_and_each_classification(self):
        issuance = self.mint()
        applied = self.open_holding_the_mint(issuance)
        output = StringIO()
        call_command("register_inclusions", "--token", str(self.tenant.token.pk), stdout=output)
        report = json.loads(output.getvalue())
        self.assertEqual(report["boundary"], {"block": applied.boundary["block"], "policy": applied.boundary["policy"]})
        self.assertEqual(
            report["inclusions"],
            [
                {
                    "kind": "issue",
                    "source": str(issuance.pk),
                    "transaction": normalized_hash(issuance.tx_hash),
                    "block_number": MINT_BLOCK,
                    "block_hash": normalized_hash(BLOCK_HASH),
                    "transaction_index": None,
                    "classification": OPENING,
                    "recorded": False,
                }
            ],
        )
        with self.assertRaises(CommandError):
            call_command("register_inclusions", "--token", str(uuid4()), stdout=StringIO())
