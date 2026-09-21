import json
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import NotFound, ValidationError

from blockchain.tests.outgoing_fixtures import BLOCK_HASH
from integrations.blockchain.receipts import normalized_hash
from tokens.models import (
    IssuanceStatus,
    RegisterEntry,
    RegisterOpening,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution
from tokens.services.register_inclusions import (
    AFTER_OPENING,
    OPENING,
    UNOPENED,
    classified_inclusions,
    classify_inclusion,
    completed_inclusions,
    opening_boundary,
    unrepresented_inclusions,
)
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
    submit_opening,
)
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tests.issuance_fixtures import IssuanceNode, admit
from tokens.tests.test_register_openings import (
    ALICE,
    BOB,
    SETTINGS,
    opening_fixture,
    opening_payload,
)
from tokens.tests.test_register_snapshot import block_hash, transfer

MINT_BLOCK = 12


@override_settings(**SETTINGS)
class RegisterInclusionTest(TransactionTestCase):
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

    def mint(self, *, amount=10, block=MINT_BLOCK):
        request = ShareIssuanceRequest.objects.create(
            token=self.tenant.token, recipient_address=self.recipient, amount=amount, reason="Allotment"
        )
        request.approve(self.actor)
        command = admit(request, self.actor)
        self.mint_node.head = self.mint_node.finalized = block
        if block != MINT_BLOCK:
            original = self.mint_node.send

            def send(raw):
                tx_hash = original(raw)
                self.mint_node.receipts[tx_hash] = {
                    **self.mint_node.receipts[tx_hash],
                    "blockNumber": block,
                    "blockHash": block_hash(block),
                }
                return tx_hash

            self.mint_node.client.send_raw_transaction.side_effect = send
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        command.refresh_from_db()
        return ShareIssuance.objects.get(pk=command.issuance_id)

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
            {**transfer(number, sender, recipient, shares), "blockHash": self.node.blocks[number]["hash"]}
            for number, sender, recipient, shares in transfers
        ]
        self.node.balances = dict(holdings)
        self.node.contract.functions.totalSupply.return_value.call.return_value = sum(holdings.values())

    def open_at(self, height, *, holdings, transfers, mapping):
        self.boundary_at(height, holdings=holdings, transfers=transfers)
        proposal = submit_opening(actor=self.owner, **self.payload(mapping=mapping))
        confirmation = prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)[
            1
        ]
        return decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            client=self.node.client,
        )

    def open_holding_the_mint(self):
        height = self.target.deployment_block
        return self.open_at(
            height,
            holdings={self.recipient: 10},
            transfers=[(height, ZERO_ADDRESS, self.recipient, 10)],
            mapping=[{"address": self.recipient, "member": str(uuid4())}],
        )

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
                    "block_number": MINT_BLOCK,
                    "block_hash": normalized_hash(BLOCK_HASH),
                }
            ],
        )
        self.assertEqual(classify_inclusion(None, inclusions[0]), UNOPENED)
        report = classified_inclusions(self.tenant.token.pk)
        self.assertIsNone(report["boundary"])
        self.assertEqual(report["inclusions"], [{**inclusions[0], "classification": UNOPENED}])

    def test_an_inclusion_in_the_boundary_block_is_represented_and_a_later_block_is_not(self):
        issuance = self.mint()
        applied = self.open_holding_the_mint()
        boundary = applied.boundary
        self.assertEqual(boundary["block"]["number"], MINT_BLOCK)
        inclusion = completed_inclusions(self.tenant.token.pk)[0]
        self.assertEqual(inclusion["source"], str(issuance.pk))
        self.assertEqual(classify_inclusion(boundary, inclusion), OPENING)
        self.assertEqual(unrepresented_inclusions(self.tenant.token.pk, boundary), [])
        later = {
            **inclusion,
            "block_number": MINT_BLOCK + 1,
            "block_hash": normalized_hash(block_hash(MINT_BLOCK + 1)),
        }
        self.assertEqual(classify_inclusion(boundary, later), AFTER_OPENING)
        self.assertEqual(
            classified_inclusions(self.tenant.token.pk)["inclusions"],
            [{**inclusion, "classification": OPENING}],
        )

    def test_the_boundary_height_reached_through_another_block_is_refused(self):
        self.mint()
        applied = self.open_holding_the_mint()
        reorganised = {
            "kind": "issue",
            "source": str(uuid4()),
            "block_number": MINT_BLOCK,
            "block_hash": normalized_hash(block_hash(MINT_BLOCK)),
        }
        self.assertNotEqual(reorganised["block_hash"], normalized_hash(applied.boundary["block"]["hash"]))
        with self.assertRaises(ValidationError):
            classify_inclusion(applied.boundary, reorganised)

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
                (self.target.deployment_block + 1, ZERO_ADDRESS, ALICE, 100),
                (self.target.deployment_block + 2, ALICE, BOB, 20),
                (later, ZERO_ADDRESS, self.recipient, 10),
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

    def test_an_unknown_share_class_is_refused_rather_than_reported_empty(self):
        with self.assertRaises(NotFound):
            classified_inclusions(uuid4())

    def test_the_command_reports_the_boundary_and_each_classification(self):
        issuance = self.mint()
        applied = self.open_holding_the_mint()
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
                    "block_number": MINT_BLOCK,
                    "block_hash": normalized_hash(BLOCK_HASH),
                    "classification": OPENING,
                }
            ],
        )
        with self.assertRaises(CommandError):
            call_command("register_inclusions", "--token", str(uuid4()), stdout=StringIO())
