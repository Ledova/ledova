import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone as utc_zone
from queue import Queue
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.db import connections
from django.test import TransactionTestCase, override_settings
from web3 import Web3

from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from shared.db import use_operator
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterMemberWallet,
    ShareIssuanceRequest,
    SwapOrderStatus,
)
from tokens.services import issuance_execution, register_inclusions
from tokens.services.register_events import (
    create_member,
    open_register,
    verify_register,
)
from tokens.services.register_inclusions import (
    AFTER_OPENING,
    classified_inclusions,
    record_completed_effects,
)
from tokens.services.register_openings import (
    decide_link,
    prepare_link_review,
    submit_link,
)
from tokens.tests import test_swap_finality
from tokens.tests.test_register_events import DAY
from tokens.tests.test_register_inclusions import MINT_BLOCK, InclusionFixtures
from tokens.tests.test_register_links import link_payload
from tokens.tests.test_register_openings import SETTINGS

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
        with patch.object(register_inclusions, "_effect", return_value=None):
            later = self.mint(block=MINT_BLOCK + 4)
        self.assertFalse(RegisterEntry.objects.filter(operation_id=later.pk).exists())
        ShareIssuanceRequest.objects.filter(executed_issuance=later).update(reviewed_by=None)
        self.assertEqual(record_completed_effects(self.tenant.token.pk), [])
        self.assertEqual([entry[0] for entry in self.entries()], ["opening"])


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=test_swap_finality.KEY,
    BLOCKCHAIN_CHAIN_ID=test_swap_finality.CHAIN_ID,
    ATOMIC_SWAP_ADDRESS=test_swap_finality.CONTRACT,
)
class RecordedTransferTest(test_swap_finality.SwapFinalityFixtures, TransactionTestCase):
    def open_register(self, *, one_member=False, link_buyer=True):
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
                changes=[{"member": str(self.seller_member.pk), "shares": str(self.swap.share_amount * 2)}],
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

    def transfers(self):
        with use_operator():
            return list(RegisterEntry.objects.filter(kind="transfer").values_list("operation_id", "changes"))

    def test_a_settlement_after_the_opening_is_recorded_as_a_transfer_by_the_transferor(self):
        self.open_register()
        self.complete()
        with use_operator():
            entry = RegisterEntry.objects.get(operation_id=self.swap.pk)
            report = verify_register(entry.register_id)
        amount = self.swap.share_amount
        self.assertEqual(
            (entry.kind, entry.changes, entry.recorded_by_id),
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
            ),
        )
        self.assertEqual(entry.effective_on, self.swap.completed_at.astimezone(utc_zone.utc).date())
        self.assertEqual((report["members"], report["issued_supply"]), (2, str(amount * 2)))
        self.assertEqual(self.swap.finalized_receipt["block_hash"], BLOCK_HASH)

    def test_a_settlement_between_one_members_wallets_records_nothing(self):
        self.open_register(one_member=True)
        self.complete()
        self.assertEqual(self.transfers(), [])
        with use_operator(), self.assertNoLogs(register_inclusions.logger, "INFO"):
            self.assertEqual(record_completed_effects(self.swap.share_token_id), [])
        with use_operator():
            self.assertEqual(verify_register(self.register_opening.register_id)["members"], 1)

    def test_a_settlement_to_an_unlinked_buyer_waits_for_its_link(self):
        self.open_register(link_buyer=False)
        self.complete()
        self.assertEqual(self.transfers(), [])
        with use_operator(), self.assertLogs(register_inclusions.logger, "INFO") as waiting:
            self.assertEqual(record_completed_effects(self.swap.share_token_id), [])
        self.assertIn(f"waits at transfer {self.swap.pk}", waiting.output[0])
        with use_operator():
            RegisterMemberWallet.objects.create(
                company_id=self.swap.share_token.company_id, member=self.buyer_member, address=self.swap.buyer_address
            )
            recorded = record_completed_effects(self.swap.share_token_id)
        self.assertEqual([entry.operation_id for entry in recorded], [self.swap.pk])
