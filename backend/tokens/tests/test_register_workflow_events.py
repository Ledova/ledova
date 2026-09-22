import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from datetime import timezone as utc_zone
from queue import Queue
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient
from web3 import Web3

from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from companies.models import Company
from shared.db import use_operator
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterMemberWallet,
    ShareIssuanceRequest,
    ShareToken,
    SwapOrderStatus,
)
from tokens.services import issuance_execution, register_inclusions
from tokens.services.register_events import (
    create_member,
    open_register,
    record_entry,
    verify_register,
)
from tokens.services.register_inclusions import (
    AFTER_OPENING,
    classified_inclusions,
    record_completed_effects,
    waiting_effects,
    waiting_list,
)
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.services.register_openings import (
    decide_link,
    prepare_link_review,
    submit_link,
)
from tokens.tests import test_swap_finality
from tokens.tests.instruction_fixtures import (
    apply_instruction,
    instruction_payload,
    instruction_reviewer,
    verified_authority,
)
from tokens.tests.issuance_fixtures import IssuanceNode, admit
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_inclusions import MINT_BLOCK, InclusionFixtures
from tokens.tests.test_register_links import link_payload
from tokens.tests.test_register_openings import SETTINGS
from tokens.tests.test_register_snapshot import block_hash

NEWCOMER = Web3.to_checksum_address("0x" + "5e" * 20)


@override_settings(**SETTINGS)
class RecordedIssueTest(InclusionFixtures, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.first = self.mint()
        self.opening = self.open_holding_the_mint(self.first)
        self.member = str(RegisterMemberWallet.objects.get(address=self.recipient).member_id)

    def entries(self):
        return list(RegisterEntry.objects.order_by("sequence").values_list("kind", "operation_id", "changes"))

    def waiting(self, issuance, block, reason, unlinked=()):
        return {
            "kind": "issue",
            "source": str(issuance.pk),
            "block": block,
            "wallets": [issuance.recipient_address],
            "shares": "10",
            "unlinked_wallets": list(unlinked),
            "reason": reason,
        }

    def link(self, address, member):
        proposal = submit_link(
            actor=self.owner,
            **link_payload(self.tenant.company, self.document, mapping=[{"address": address, "member": member}]),
        )
        _, confirmation = prepare_link_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        return decide_link(proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply")

    def test_an_issue_after_the_opening_is_recorded_with_its_completion_by_the_approving_reviewer(self):
        later = self.mint(block=MINT_BLOCK + 4)
        entry = RegisterEntry.objects.get(operation_id=later.pk)
        request = ShareIssuanceRequest.objects.get(executed_issuance=later)
        self.assertEqual(
            (entry.kind, entry.changes, entry.recorded_by_id, entry.effective_on),
            (
                "issue",
                [{"member": self.member, "shares": "10"}],
                request.reviewed_by_id,
                later.completed_at.astimezone(utc_zone.utc).date(),
            ),
        )
        self.assertFalse(RegisterEntry.objects.filter(operation_id=self.first.pk).exists())
        self.assertEqual(verify_register(entry.register_id)["issued_supply"], "20")
        self.assertEqual(record_completed_effects(self.tenant.token.pk), [])
        self.assertEqual(RegisterEntry.objects.count(), 2)

    def test_an_issue_to_an_unlinked_wallet_waits_and_holds_later_issues_until_its_link_is_approved(self):
        waiting = self.mint(block=MINT_BLOCK + 4, recipient=NEWCOMER)
        behind = self.mint(block=MINT_BLOCK + 6)
        self.assertEqual([entry[0] for entry in self.entries()], ["opening"])
        self.assertEqual(waiting_effects(self.tenant.token.pk), 2)
        rows = {row["source"]: row for row in classified_inclusions(self.tenant.token.pk)["inclusions"]}
        self.assertEqual(
            {
                source: (row["classification"], row["recorded"])
                for source, row in rows.items()
                if source != str(self.first.pk)
            },
            {str(waiting.pk): (AFTER_OPENING, False), str(behind.pk): (AFTER_OPENING, False)},
        )
        newcomer = str(uuid4())
        self.assertEqual(self.link(NEWCOMER, newcomer).status, "applied")
        self.assertEqual(
            self.entries(),
            [
                ("opening", self.opening.pk, [{"member": self.member, "shares": "10"}]),
                ("issue", waiting.pk, [{"member": newcomer, "shares": "10"}]),
                ("issue", behind.pk, [{"member": self.member, "shares": "10"}]),
            ],
        )
        self.assertEqual(verify_register(RegisterEntry.objects.first().register_id)["members"], 2)
        self.assertEqual(waiting_effects(self.tenant.token.pk), 0)

    def test_a_link_approved_during_a_completion_waits_for_it_and_records_its_issue_once(self):
        command = self.admitted(block=MINT_BLOCK + 4, recipient=NEWCOMER)
        proposal = submit_link(
            actor=self.owner,
            **link_payload(self.tenant.company, self.document, mapping=[{"address": NEWCOMER, "member": str(uuid4())}]),
        )
        _, confirmation = prepare_link_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        held, release, pids, errors = Event(), Event(), Queue(), []
        recorder = issuance_execution.record_completed_effects

        def paused(token_id):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pids.put(("complete", cursor.fetchone()[0]))
            held.set()
            if not release.wait(timeout=10):
                raise RuntimeError("Test synchronization timed out")
            return recorder(token_id)

        def complete():
            try:
                with patch.object(issuance_execution, "record_completed_effects", side_effect=paused):
                    return issuance_execution.recover(command.pk)["status"]
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
            finally:
                connections.close_all()

        def approve():
            try:
                if not held.wait(timeout=10):
                    raise RuntimeError("Test synchronization timed out")
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(("approve", cursor.fetchone()[0]))
                return decide_link(
                    proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
                ).status
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            completed, approved = pool.submit(complete), pool.submit(approve)
            workers = dict(pids.get(timeout=10) for _ in range(2))
            deadline, blocked = time.monotonic() + 8, False
            while time.monotonic() < deadline and not blocked:
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_blocking_pids(%s)", [workers["approve"]])
                    blocked = workers["complete"] in (cursor.fetchone()[0] or [])
                time.sleep(0.02)
            release.set()
            outcomes = (completed.result(timeout=20), approved.result(timeout=20))
        self.assertTrue(blocked, "The link approval never waited for the completion's share-class lock")
        self.assertFalse(errors, errors)
        self.assertEqual(outcomes, ("executed", "applied"))
        command.refresh_from_db()
        self.assertEqual(
            list(RegisterEntry.objects.filter(kind="issue").values_list("operation_id", flat=True)),
            [command.issuance_id],
        )

    def test_a_refused_append_leaves_the_completion_committed_and_is_recorded_later(self):
        with patch.object(register_inclusions, "record_entry", side_effect=RegisterChangeConflict()):
            later = self.mint(block=MINT_BLOCK + 4)
        later.refresh_from_db()
        self.assertEqual(later.status, "completed")
        self.assertFalse(RegisterEntry.objects.filter(operation_id=later.pk).exists())
        with use_operator():
            recorded = record_completed_effects(self.tenant.token.pk)
        self.assertEqual([entry.operation_id for entry in recorded], [later.pk])
        self.assertEqual(verify_register(recorded[0].register_id)["issued_supply"], "20")

    def test_an_unapproved_request_waits_rather_than_inventing_a_recorder(self):
        with patch.object(issuance_execution, "record_completed_effects"):
            later = self.mint(block=MINT_BLOCK + 4)
        self.assertFalse(RegisterEntry.objects.filter(operation_id=later.pk).exists())
        ShareIssuanceRequest.objects.filter(executed_issuance=later).update(reviewed_by=None)
        self.assertEqual(record_completed_effects(self.tenant.token.pk), [])
        self.assertEqual([entry[0] for entry in self.entries()], ["opening"])

    def test_the_recorder_is_the_reviewer_who_applied_the_instruction_not_the_admitting_operator(self):
        reviewer = instruction_reviewer()
        later = self.mint(block=MINT_BLOCK + 4, reviewer=reviewer)
        entry = RegisterEntry.objects.get(operation_id=later.pk)
        self.assertEqual(entry.recorded_by_id, reviewer.pk)
        self.assertNotEqual(entry.recorded_by_id, self.actor.pk)

    def test_an_approval_from_before_instructions_waits_until_an_instruction_covers_it(self):
        legacy = self.mint(block=MINT_BLOCK + 4, instructed=False)
        behind = self.mint(block=MINT_BLOCK + 6)
        self.assertEqual([entry[0] for entry in self.entries()], ["opening"])
        self.assertEqual(waiting_effects(self.tenant.token.pk), 2)
        request = ShareIssuanceRequest.objects.get(executed_issuance=legacy)
        reviewed = (request.status, request.reviewed_by_id, request.reviewed_at, request.review_notes)
        covering = instruction_reviewer()
        self.assertEqual(
            apply_instruction(self.tenant.token, request, reviewer=covering, document=self.document).status, "applied"
        )
        request.refresh_from_db()
        self.assertEqual((request.status, request.reviewed_by_id, request.reviewed_at, request.review_notes), reviewed)
        self.assertEqual(
            self.entries(),
            [
                ("opening", self.opening.pk, [{"member": self.member, "shares": "10"}]),
                ("issue", legacy.pk, [{"member": self.member, "shares": "10"}]),
                ("issue", behind.pk, [{"member": self.member, "shares": "10"}]),
            ],
        )
        self.assertEqual(RegisterEntry.objects.get(operation_id=legacy.pk).recorded_by_id, self.actor.pk)
        self.assertEqual(waiting_effects(self.tenant.token.pk), 0)
        with self.assertRaisesMessage(ValidationError, "neither awaiting approval"):
            apply_instruction(self.tenant.token, request, reviewer=covering, document=self.document)

    def test_an_issue_recorded_before_instructions_stays_and_needs_no_cover(self):
        with patch.object(register_inclusions, "issue_covered", return_value=True):
            recorded = self.mint(block=MINT_BLOCK + 4, instructed=False)
        entry = RegisterEntry.objects.get(operation_id=recorded.pk)
        self.assertEqual(record_completed_effects(self.tenant.token.pk), [])
        self.assertEqual(waiting_effects(self.tenant.token.pk), 0)
        self.assertEqual(RegisterEntry.objects.get(operation_id=recorded.pk).entry_hash, entry.entry_hash)
        request = ShareIssuanceRequest.objects.get(executed_issuance=recorded)
        with self.assertRaisesMessage(ValidationError, "neither awaiting approval"):
            apply_instruction(self.tenant.token, request, document=self.document)
        self.assertFalse(register_inclusions.issue_covered(request))

    def test_each_waiting_effect_is_listed_in_chain_order_with_the_reason_it_waits(self):
        departed = instruction_reviewer()
        held = self.mint()
        unlinked = self.mint(block=MINT_BLOCK + 4, recipient=NEWCOMER)
        unreviewed = self.mint(block=MINT_BLOCK + 6, instructed=False, reviewer=departed)
        uninstructed = self.mint(block=MINT_BLOCK + 8, instructed=False)
        behind = self.mint(block=MINT_BLOCK + 10)
        departed.delete()
        expected = [
            self.waiting(held, MINT_BLOCK, "attribution"),
            self.waiting(unlinked, MINT_BLOCK + 4, "unlinked", [unlinked.recipient_address]),
            self.waiting(unreviewed, MINT_BLOCK + 6, "unreviewed"),
            self.waiting(uninstructed, MINT_BLOCK + 8, "uninstructed"),
            self.waiting(behind, MINT_BLOCK + 10, "behind"),
        ]
        self.assertEqual(waiting_list(self.tenant.token.pk), expected)
        self.assertEqual(waiting_effects(self.tenant.token.pk), len(expected))
        self.assertEqual([entry[0] for entry in self.entries()], ["opening"])
        client = APIClient()
        client.force_authenticate(self.owner)
        path = f"/api/v1/tokens/{self.tenant.token.uuid}/"
        response = client.get(f"{path}register/waiting/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "effects": [
                    {("unlinkedWallets" if key == "unlinked_wallets" else key): value for key, value in row.items()}
                    for row in expected
                ]
            },
        )
        self.assertEqual(client.get(f"{path}holders/").json()["waitingEffects"], len(expected))
        client.force_authenticate(register_fixture()[0])
        self.assertEqual(client.get(f"{path}register/waiting/").status_code, 404)

    def test_an_entry_that_waited_is_dated_the_day_it_is_made_and_one_on_time_its_completion_date(self):
        on_time = self.mint(block=MINT_BLOCK + 2)
        unlinked = self.mint(block=MINT_BLOCK + 4, recipient=NEWCOMER)
        uninstructed = self.mint(block=MINT_BLOCK + 6, instructed=False)
        linked_on = unlinked.completed_at + timedelta(days=2)
        covered_on = unlinked.completed_at + timedelta(days=5)
        with patch("django.utils.timezone.now", return_value=linked_on):
            self.assertEqual(self.link(NEWCOMER, str(uuid4())).status, "applied")
        request = ShareIssuanceRequest.objects.get(executed_issuance=uninstructed)
        with patch("django.utils.timezone.now", return_value=covered_on):
            self.assertEqual(apply_instruction(self.tenant.token, request, document=self.document).status, "applied")
        self.assertEqual(
            dict(RegisterEntry.objects.filter(kind="issue").values_list("operation_id", "effective_on")),
            {
                on_time.pk: on_time.completed_at.astimezone(utc_zone.utc).date(),
                unlinked.pk: linked_on.date(),
                uninstructed.pk: covered_on.date(),
            },
        )
        self.assertEqual(waiting_list(self.tenant.token.pk), [])

    def test_an_entry_dated_before_the_register_head_is_refused_and_listed_until_its_day_comes(self):
        register_id = self.opening.applied_entry.register_id
        earlier = record_entry(
            register_id=register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": self.member, "shares": "5"}],
            effective_on=self.opening.applied_entry.effective_on,
            recorded_by=self.reviewer,
        )
        ahead = timezone.now() + timedelta(days=10)
        record_entry(
            register_id=register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.CORRECTION,
            changes=[{"member": self.member, "shares": "-5"}],
            effective_on=ahead.date(),
            recorded_by=self.reviewer,
            corrects_id=earlier.pk,
        )
        with self.assertLogs(register_inclusions.logger, "WARNING"):
            refused = self.mint(block=MINT_BLOCK + 4)
        self.assertFalse(RegisterEntry.objects.filter(operation_id=refused.pk).exists())
        self.assertEqual(waiting_list(self.tenant.token.pk), [self.waiting(refused, MINT_BLOCK + 4, "refused")])
        with patch("django.utils.timezone.now", return_value=ahead):
            (recorded,) = record_completed_effects(self.tenant.token.pk)
        self.assertEqual((recorded.operation_id, recorded.effective_on), (refused.pk, ahead.date()))
        self.assertEqual(waiting_list(self.tenant.token.pk), [])

    def test_an_instruction_applied_during_a_later_completion_waits_for_it_and_records_both_in_order(self):
        legacy = self.mint(block=MINT_BLOCK + 4, instructed=False)
        request = ShareIssuanceRequest.objects.get(executed_issuance=legacy)
        command = self.admitted(block=MINT_BLOCK + 6)
        proposal = submit_instruction(
            actor=self.owner, **instruction_payload(self.tenant.token, self.document, [request])
        )
        _, _, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        held, release, pids, errors = Event(), Event(), Queue(), []
        recorder = issuance_execution.record_completed_effects

        def paused(token_id):
            recorded = recorder(token_id)
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pids.put(("complete", cursor.fetchone()[0]))
            held.set()
            if not release.wait(timeout=10):
                raise RuntimeError("Test synchronization timed out")
            return recorded

        def complete():
            try:
                with patch.object(issuance_execution, "record_completed_effects", side_effect=paused):
                    return issuance_execution.recover(command.pk)["status"]
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
            finally:
                connections.close_all()

        def apply():
            try:
                if not held.wait(timeout=10):
                    raise RuntimeError("Test synchronization timed out")
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(("apply", cursor.fetchone()[0]))
                return decide_instruction(
                    proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
                ).status
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            completed, applied = pool.submit(complete), pool.submit(apply)
            workers = dict(pids.get(timeout=10) for _ in range(2))
            deadline, blocked = time.monotonic() + 8, False
            while time.monotonic() < deadline and not blocked:
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_blocking_pids(%s)", [workers["apply"]])
                    blocked = workers["complete"] in (cursor.fetchone()[0] or [])
                time.sleep(0.02)
            release.set()
            outcomes = (completed.result(timeout=20), applied.result(timeout=20))
        self.assertTrue(blocked, "The instruction never waited for the completion's share-class lock")
        self.assertFalse(errors, errors)
        self.assertEqual(outcomes, ("executed", "applied"))
        command.refresh_from_db()
        self.assertEqual(
            list(
                RegisterEntry.objects.filter(kind="issue").order_by("sequence").values_list("operation_id", flat=True)
            ),
            [legacy.pk, command.issuance_id],
        )
        self.assertEqual(waiting_effects(self.tenant.token.pk), 0)


SETTLEMENT = dict(
    BLOCKCHAIN_OPERATOR_KEY=test_swap_finality.KEY,
    BLOCKCHAIN_CHAIN_ID=test_swap_finality.CHAIN_ID,
    ATOMIC_SWAP_ADDRESS=test_swap_finality.CONTRACT,
)


class SettledTransferFixtures(test_swap_finality.SwapFinalityFixtures):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.owner = get_user_model().objects.create_user(
                email=f"settled-issuer-{uuid4()}@example.test", is_active=True
            )
            Company.objects.filter(pk=self.swap.share_token.company_id).update(owner=self.owner)
            self.reviewer = instruction_reviewer()
            self.document = verified_authority(Company.objects.get(pk=self.swap.share_token.company_id), self.reviewer)

    def open_register(self, *, one_member=False, link_buyer=True, held=None):
        with use_operator():
            company_id = self.swap.share_token.company_id
            self.seller_member = create_member(company_id=company_id, member_id=uuid4())
            self.buyer_member = (
                self.seller_member if one_member else create_member(company_id=company_id, member_id=uuid4())
            )
            links = [(self.swap.seller_address, self.seller_member)]
            if link_buyer:
                links.append((self.swap.buyer_address, self.buyer_member))
            for address, member in links:
                RegisterMemberWallet.objects.create(company_id=company_id, member=member, address=address)
            self.register_opening = open_register(
                token_id=self.swap.share_token_id,
                operation_id=uuid4(),
                changes=[{"member": str(self.seller_member.pk), "shares": str(held or self.swap.share_amount * 2)}],
                effective_on=DAY,
                recorded_by=self.fixture.seller.user,
            )
        boundary = {
            "block": {"number": 11, "hash": "0x" + "a1" * 32},
            "deployment_block": 2,
            "deployment_hash": "0x" + "a2" * 32,
            "history": [],
        }
        self.enterContext(patch.object(register_inclusions, "opening_boundary", return_value=boundary))

    def complete(self):
        self.confirm()
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=test_swap_finality.FINALIZED):
            self.node.advance(head=20, finalized=12)
            self.assertEqual(self.settle(), SwapOrderStatus.COMPLETED)

    def instruct(self):
        with use_operator():
            token = ShareToken.objects.get(pk=self.swap.share_token_id)
            return apply_instruction(token, self.swap, reviewer=self.reviewer, document=self.document)

    def admitted(self, *, block=14):
        node = IssuanceNode()
        node.head = node.finalized = block
        sent = node.send

        def send(raw):
            tx_hash = sent(raw)
            node.receipts[tx_hash] = {**node.receipts[tx_hash], "blockNumber": block, "blockHash": block_hash(block)}
            return tx_hash

        node.client.send_raw_transaction.side_effect = send
        for target, value in (
            ("tokens.services.issuance_execution.get_base_chain_client", node.client),
            ("tokens.services.share_token_service.is_recipient_whitelisted", True),
        ):
            self.enterContext(patch(target, return_value=value))
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))
        self.enterContext(override_settings(WALLET_CHAIN_FINALITY_POLICIES=test_swap_finality.FINALIZED))
        with use_operator():
            token = ShareToken.objects.get(pk=self.swap.share_token_id)
            request = ShareIssuanceRequest.objects.create(
                token=token, recipient_address=self.swap.buyer_address, amount=5, reason="Allotment"
            )
            apply_instruction(token, request, reviewer=self.reviewer, document=self.document)
            actor = get_user_model().objects.create_superuser(
                email=f"settled-operator-{uuid4()}@example.test", password="synthetic"
            )
            return admit(ShareIssuanceRequest.objects.get(pk=request.pk), actor)

    def transfers(self):
        with use_operator():
            return list(RegisterEntry.objects.filter(kind="transfer").values_list("operation_id", "changes"))

    def entries(self):
        with use_operator():
            return list(
                RegisterEntry.objects.exclude(kind="opening").order_by("sequence").values_list("kind", "operation_id")
            )

    def waiting(self, reason, unlinked=()):
        return {
            "kind": "transfer",
            "source": str(self.swap.pk),
            "block": self.swap.finalized_receipt["block_number"],
            "wallets": [self.swap.seller_address, self.swap.buyer_address],
            "shares": str(self.swap.share_amount),
            "unlinked_wallets": list(unlinked),
            "reason": reason,
        }


@override_settings(**SETTLEMENT)
class RecordedTransferTest(SettledTransferFixtures, TransactionTestCase):
    def test_a_settlement_after_the_opening_waits_for_its_instruction_and_is_recorded_by_the_transferor(self):
        self.open_register()
        self.complete()
        self.assertEqual(self.transfers(), [])
        with use_operator():
            self.assertEqual(waiting_list(self.swap.share_token_id), [self.waiting("uninstructed")])
            self.assertEqual(record_completed_effects(self.swap.share_token_id), [])
        instructed_on = self.swap.completed_at + timedelta(days=2)
        with patch("django.utils.timezone.now", return_value=instructed_on):
            self.assertEqual(self.instruct().status, "applied")
        with use_operator():
            entry = RegisterEntry.objects.get(operation_id=self.swap.pk)
            report = verify_register(entry.register_id)
            self.assertEqual(waiting_list(self.swap.share_token_id), [])
        amount = self.swap.share_amount
        self.assertEqual(
            (entry.kind, entry.changes, entry.recorded_by_id, entry.effective_on),
            (
                "transfer",
                sorted(
                    [
                        {"member": str(self.seller_member.pk), "shares": str(-amount)},
                        {"member": str(self.buyer_member.pk), "shares": str(amount)},
                    ],
                    key=lambda change: change["member"],
                ),
                self.fixture.seller.user.pk,
                instructed_on.date(),
            ),
        )
        self.assertNotEqual(entry.recorded_by_id, self.owner.pk)
        self.assertEqual((report["members"], report["issued_supply"]), (2, str(amount * 2)))
        self.assertEqual(self.swap.finalized_receipt["block_hash"], BLOCK_HASH)

    def test_a_settlement_between_one_members_wallets_records_nothing_and_needs_no_instruction(self):
        self.open_register(one_member=True)
        self.complete()
        self.assertEqual(self.transfers(), [])
        with use_operator(), self.assertNoLogs(register_inclusions.logger, "INFO"):
            self.assertEqual(record_completed_effects(self.swap.share_token_id), [])
        with use_operator():
            self.assertEqual(verify_register(self.register_opening.register_id)["members"], 1)
            self.assertEqual(waiting_effects(self.swap.share_token_id), 0)

    def test_a_settlement_to_an_unlinked_buyer_waits_for_its_link(self):
        self.open_register(link_buyer=False)
        self.complete()
        self.assertEqual(self.instruct().status, "applied")
        self.assertEqual(self.transfers(), [])
        with use_operator(), self.assertLogs(register_inclusions.logger, "INFO") as waiting:
            self.assertEqual(record_completed_effects(self.swap.share_token_id), [])
        self.assertIn(f"waits at transfer {self.swap.pk}", waiting.output[0])
        with use_operator():
            self.assertEqual(waiting_effects(self.swap.share_token_id), 1)
            self.assertEqual(
                waiting_list(self.swap.share_token_id), [self.waiting("unlinked", [self.swap.buyer_address])]
            )
            RegisterMemberWallet.objects.create(
                company_id=self.swap.share_token.company_id, member=self.buyer_member, address=self.swap.buyer_address
            )
            linked_on = self.swap.completed_at + timedelta(days=3)
            with patch("django.utils.timezone.now", return_value=linked_on):
                recorded = record_completed_effects(self.swap.share_token_id)
            self.assertEqual(waiting_effects(self.swap.share_token_id), 0)
        self.assertEqual(
            [(entry.operation_id, entry.effective_on) for entry in recorded], [(self.swap.pk, linked_on.date())]
        )

    def test_a_transfer_the_register_refuses_is_listed_as_refused(self):
        self.open_register(held=self.swap.share_amount // 2)
        self.complete()
        with use_operator():
            self.assertEqual(waiting_list(self.swap.share_token_id), [self.waiting("uninstructed")])
        with self.assertLogs(register_inclusions.logger, "WARNING") as refused:
            self.assertEqual(self.instruct().status, "applied")
        self.assertIn(f"The register refused transfer {self.swap.pk}", refused.output[0])
        self.assertEqual(self.transfers(), [])
        with use_operator():
            self.assertEqual(waiting_list(self.swap.share_token_id), [self.waiting("refused")])
            self.assertEqual(waiting_effects(self.swap.share_token_id), 1)

    def test_a_settlement_waiting_for_its_instruction_holds_a_later_issue_and_both_record_in_chain_order(self):
        self.open_register()
        self.complete()
        command = self.admitted()
        with use_operator():
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
            command.refresh_from_db()
            self.assertEqual(
                [(row["kind"], row["source"], row["reason"]) for row in waiting_list(self.swap.share_token_id)],
                [("transfer", str(self.swap.pk), "uninstructed"), ("issue", str(command.issuance_id), "behind")],
            )
        self.assertEqual(self.entries(), [])
        self.assertEqual(self.instruct().status, "applied")
        self.assertEqual(self.entries(), [("transfer", self.swap.pk), ("issue", command.issuance_id)])
        with use_operator():
            self.assertEqual(waiting_effects(self.swap.share_token_id), 0)

    def test_a_transfer_recorded_before_instructions_stays_and_needs_no_cover(self):
        self.open_register()
        with patch.object(register_inclusions, "transfer_covered", return_value=True):
            self.complete()
        with use_operator():
            entry = RegisterEntry.objects.get(operation_id=self.swap.pk)
            self.assertEqual(record_completed_effects(self.swap.share_token_id), [])
            self.assertEqual(waiting_effects(self.swap.share_token_id), 0)
            self.assertEqual(RegisterEntry.objects.get(operation_id=self.swap.pk).entry_hash, entry.entry_hash)
            self.assertFalse(register_inclusions.transfer_covered(self.swap))
        with self.assertRaisesMessage(ValidationError, "entered in the register"):
            self.instruct()

    def test_an_instruction_applied_during_a_later_completion_waits_for_it_and_records_both_in_order(self):
        self.open_register()
        self.complete()
        command = self.admitted()
        with use_operator():
            token = ShareToken.objects.get(pk=self.swap.share_token_id)
            proposal = submit_instruction(actor=self.owner, **instruction_payload(token, self.document, [self.swap]))
            _, _, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        held, release, pids, errors = Event(), Event(), Queue(), []
        recorder = issuance_execution.record_completed_effects

        def paused(token_id):
            recorded = recorder(token_id)
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pids.put(("complete", cursor.fetchone()[0]))
            held.set()
            if not release.wait(timeout=10):
                raise RuntimeError("Test synchronization timed out")
            return recorded

        def complete():
            try:
                with patch.object(issuance_execution, "record_completed_effects", side_effect=paused):
                    return issuance_execution.recover(command.pk)["status"]
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
            finally:
                connections.close_all()

        def apply():
            try:
                if not held.wait(timeout=10):
                    raise RuntimeError("Test synchronization timed out")
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(("apply", cursor.fetchone()[0]))
                return decide_instruction(
                    proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
                ).status
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            completed, applied = pool.submit(complete), pool.submit(apply)
            workers = dict(pids.get(timeout=10) for _ in range(2))
            deadline, blocked = time.monotonic() + 8, False
            while time.monotonic() < deadline and not blocked:
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_blocking_pids(%s)", [workers["apply"]])
                    blocked = workers["complete"] in (cursor.fetchone()[0] or [])
                time.sleep(0.02)
            release.set()
            outcomes = (completed.result(timeout=20), applied.result(timeout=20))
        self.assertTrue(blocked, "The instruction never waited for the completion's share-class lock")
        self.assertFalse(errors, errors)
        self.assertEqual(outcomes, ("executed", "applied"))
        command.refresh_from_db()
        self.assertEqual(self.entries(), [("transfer", self.swap.pk), ("issue", command.issuance_id)])
        with use_operator():
            self.assertEqual(waiting_effects(self.swap.share_token_id), 0)
