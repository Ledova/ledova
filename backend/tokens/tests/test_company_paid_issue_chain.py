from decimal import Decimal
from functools import partial
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import override_settings
from django.utils import timezone
from eth_account import Account
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from assets.models import Asset
from blockchain.models import SignedAttempt
from companies.services.authority_requests import _requester_principal
from companies.services.editing import update_company
from companies.services.team import revoke_company_appointment
from integrations.base_chain import get_base_chain_client
from integrations.base_chain.client import BaseChainClient
from ledova_backend.procrastinate_app import app
from offerings.exceptions import SubscriptionRefusedException
from offerings.models import Offering, OfferingExemption, SettlementRail, Subscription
from offerings.services.offering import submit_offering, transition_offering
from offerings.services.subscription import (
    accept,
    confirm_payment,
    create_draft,
    issue_instruction,
    record_refund,
    submit,
)
from offerings.tasks import allot_subscription_task
from offerings.tests.factories import configure_operator, subscription_technical_actor
from shared.db import use_operator
from shared.seeds.synthetic.chain.deferred import captured
from shared.seeds.synthetic.chain.offerings import allot_round
from shared.seeds.synthetic.chain.records import Records
from shared.seeds.synthetic.chain.story import ALLOTTED
from tokens.models import (
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterInstruction,
    RegisterInstructionDecision,
    RegisterPosition,
    ShareIssuanceExecution,
    ShareRegister,
)
from tokens.services import issuance_execution
from tokens.services.register_inclusions import waiting_list
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening,
    preview_opening_decision,
)
from tokens.services.register_paid_issues import (
    decide_paid_issue,
    prepare_paid_issue,
    preview_paid_issue_decision,
)
from tokens.tests.company_wallet_chain_fixtures import install_company_wallet_chain
from tokens.tests.evidence_fixtures import upload_evidence
from tokens.tests.test_chain_integration import (
    CHAIN_SETTINGS,
    chain_available,
    isolate_chain,
    reset_chain_client,
)
from tokens.tests.test_register_links import linked
from users.tasks.notifications import send_push_notification
from wallets.models import Holding
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases


@chain_available
@override_settings(**CHAIN_SETTINGS)
class CompanyPaidIssueChainTest(CompanyWalletCases, APITransactionTestCase):
    def setUp(self):
        reset_chain_client()
        self.chain = get_base_chain_client()
        isolate_chain(self, self.chain.w3)
        super().setUp()
        install_company_wallet_chain(self)
        evidence = upload_evidence(self.owner, self.initial, RegisterEvidenceKind.AUTHORITY)
        opening, _ = prepare_opening(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            token_id=self.token.pk,
            authority_evidence=evidence.pk,
            mapping=[],
            authority="director_resolution",
            approving_director="Synthetic Director",
            authority_reference="PAID-ZERO-CHAIN",
            reason="Open the actual empty class before paid issuance",
            client=self.chain,
        )
        for kind in ("approve", "apply"):
            _, preview = preview_opening_decision(
                actor=self.owner, opening_id=opening.pk, appointment=self.initial.pk, kind=kind
            )
            opening = decide_opening(
                actor=self.owner,
                opening_id=opening.pk,
                appointment=self.initial.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        wallet_instruction = self.prepare_wallet(self.nominate())
        self.wallet_decide(wallet_instruction, "approve")
        wallet_instruction, _ = self.wallet_decide(wallet_instruction, "apply")
        self.assertEqual(self.execute(wallet_instruction).status, "confirmed")
        self.technical = subscription_technical_actor()
        self.company = update_company(self.company, {"is_open_to_investors": True}, actor=self.owner)
        with use_operator():
            configure_operator()
            self.offer = Offering.objects.create(
                token=self.token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=Decimal("2.50"),
                minimum_shares=1,
                target_shares=100,
                cap_shares=100,
                maximum_shares=100,
                opens_at=timezone.now(),
                summary="Synthetic paid issue terms",
            )
            submit_offering(self.offer, submitted_by=self.owner)
            transition_offering(self.offer, "approve", reviewed_by=self.technical)
            self.offer.refresh_from_db()
        with use_operator(), _requester_principal(self.participant.pk):
            self.subscription = create_draft(self.offer, self.account, self.wallet, 25, submitted_by=self.participant)
            submit(self.subscription, submitted_by=self.participant)
        with use_operator(), _requester_principal(self.technical.pk):
            accept(self.subscription)
            issue_instruction(self.subscription, SettlementRail.BANK_TRANSFER)
            confirm_payment(
                self.subscription,
                amount_received=Decimal("65.00"),
                received_on=timezone.now().date(),
                confirmed_by=self.technical,
                reference_seen=self.subscription.reference,
            )
            self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.status, "paid")
        self.assertEqual(self.subscription.allotment_quantity, 25)
        self.assertEqual(self.subscription.refund_amount, Decimal("2.50"))
        self.assertIsNone(self.subscription.refunded_at)
        self.assertIsNotNone(self.subscription.eligibility_decision_id)
        self.assertIsNotNone(self.subscription.payment_confirmed_at)

    def paid_proposal(self):
        evidence = upload_evidence(self.owner, self.initial, RegisterEvidenceKind.AUTHORITY)
        return prepare_paid_issue(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            subscription=self.subscription.pk,
            approving_director="Synthetic Director",
            authority_reference="ORIGINAL-PAID-ISSUE",
            reason="Issue the exact paid whole shares",
            authority_evidence=evidence.pk,
        )

    def paid_decide(self, proposal, kind, actor, appointment):
        _, preview = preview_paid_issue_decision(
            actor=actor, paid_issue_id=proposal.pk, appointment=appointment.pk, kind=kind
        )
        self.assertEqual(preview["unmet_requirements"], [])
        return decide_paid_issue(
            actor=actor,
            paid_issue_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )

    def test_synthetic_allotment_uses_company_mandate_original_job_and_real_mint_then_waits_for_link(self):
        self.assertFalse(self.owner.is_staff or self.owner.is_superuser)
        application = SimpleNamespace(
            status=ALLOTTED,
            investor="participant",
            address=self.wallet.address,
            allotted=25,
            refund=Decimal("2.50"),
            payments=[SimpleNamespace(final=False)],
        )
        item = SimpleNamespace(key="paid-round", share_class="company/ORD", applications=[application])
        records = SimpleNamespace(
            classes={item.share_class: self.token},
            subscriptions={(item.key, application.investor, application.address): self.subscription},
            owner=lambda key: self.owner,
            plan=SimpleNamespace(directors={"company": "Synthetic Director"}),
        )
        nonce = self.chain.w3.eth.get_transaction_count(self.signer, "pending")
        with captured() as deferrals:
            records.run = lambda: deferrals.run(
                {
                    allot_subscription_task.name: allot_subscription_task,
                    send_push_notification.name: partial(Records.notify, records),
                }
            )
            self.assertEqual(allot_round(item, records), [self.subscription])
        with use_operator():
            proposal = RegisterInstruction.objects.get(paid_subscription=self.subscription)
            execution = ShareIssuanceExecution.objects.select_related("operation__current_attempt").get(
                source_instruction=proposal
            )
            subscription = Subscription.objects.get(pk=self.subscription.pk)
            attempt = execution.operation.current_attempt
            receipt = self.chain.w3.eth.get_transaction_receipt(attempt.tx_hash)
            mint = self.contract.events.Transfer().process_receipt(receipt)
            self.assertEqual(
                [(event["args"]["to"].lower(), event["args"]["value"]) for event in mint],
                [(self.wallet.address.lower(), 25)],
            )
            self.assertEqual(
                (proposal.status, execution.authority, execution.executed_by_id), ("applied", "company", self.owner.pk)
            )
            self.assertEqual(proposal.authority_evidence.uploaded_by_id, self.owner.pk)
            self.assertEqual(execution.subscription_id, subscription.pk)
            self.assertEqual(execution.intent, proposal.intent)
            self.assertEqual(subscription.issuance_request_id, proposal.request_id)
            self.assertEqual(
                (subscription.status, subscription.amount_received, subscription.money_backing_shares),
                ("allotted", Decimal("65.00"), Decimal("62.50")),
            )
            self.assertIsNotNone(subscription.allotted_at)
            self.assertIsNotNone(subscription.refunded_at)
            self.assertEqual(subscription.refund_amount, Decimal("2.50"))
            decisions = RegisterInstructionDecision.objects.filter(instruction=proposal)
            self.assertEqual(set(decisions.values_list("kind", flat=True)), {"approve", "apply"})
            self.assertEqual(set(decisions.values_list("decided_by_id", flat=True)), {self.owner.pk})
            self.assertEqual(attempt.nonce, nonce)
            self.assertEqual(Account.recover_transaction(bytes(attempt.raw_transaction)), self.signer)
            self.assertEqual(Web3.to_hex(Web3.keccak(bytes(attempt.raw_transaction))), attempt.tx_hash)
            self.assertEqual(
                Holding.objects.get(
                    wallet=self.wallet, asset=Asset.get_by_chain_and_contract("base", self.token.contract_address)
                ).quantity,
                Decimal("25"),
            )
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 0)
            self.assertFalse(RegisterEntry.objects.filter(operation_id=execution.issuance_id).exists())
            self.assertEqual([effect["reason"] for effect in waiting_list(self.token.pk)], ["unlinked"])
        member = uuid4()
        linked(self.owner, self.initial, [{"address": self.wallet.address, "member": str(member)}])
        with use_operator():
            entry = RegisterEntry.objects.get(operation_id=execution.issuance_id, kind="issue")
            self.assertEqual(entry.changes, [{"member": str(member), "shares": "25"}])
            self.assertEqual(entry.recorded_by_id, self.owner.pk)
            self.assertEqual(RegisterPosition.objects.get(register__token=self.token, member_id=member).shares, 25)
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 25)
            raw = bytes(attempt.raw_transaction)
            with patch.object(BaseChainClient, "send_raw_transaction", side_effect=AssertionError("Original receipt")):
                self.assertEqual(issuance_execution.recover(execution.pk)["status"], "executed")
            self.assertEqual(SignedAttempt.objects.filter(operation_id=execution.operation_id).count(), 1)
            self.assertEqual(bytes(SignedAttempt.objects.get(pk=attempt.pk).raw_transaction), raw)
            self.assertEqual(RegisterEntry.objects.filter(operation_id=execution.issuance_id).count(), 1)
        self.assertEqual(self.contract.functions.totalSupply().call(), 25)
        self.assertEqual(self.chain.w3.eth.get_transaction_count(self.signer, "pending"), nonce + 1)

    def test_original_confirmed_paid_mint_projects_after_consumed_approver_and_applier_revocation(self):
        approver, _, approving = self.appointee("paid-real-approver", ["approve"])
        applier, _, applying = self.appointee("paid-real-applier", ["apply"])
        proposal = self.paid_proposal()
        with captured() as deferrals, patch("tokens.services.issuance_execution.App", return_value=app):
            self.paid_decide(proposal, "approve", approver, approving)
            proposal = self.paid_decide(proposal, "apply", applier, applying)
            jobs = deferrals.drain()
        self.assertEqual(len(jobs), 1)
        task, arguments = jobs[0]
        self.assertEqual(task, allot_subscription_task.name)
        self.assertEqual(arguments["executed_by"], applier.pk)
        self.assertEqual(arguments["subscription_uuid"], str(self.subscription.pk))
        nonce = self.chain.w3.eth.get_transaction_count(self.signer, "pending")
        with patch("tokens.services.issuance_execution._project", side_effect=RuntimeError("Projection lost")):
            with self.assertRaisesRegex(RuntimeError, "Projection lost"):
                allot_subscription_task(**arguments)
        with use_operator():
            execution = ShareIssuanceExecution.objects.select_related("operation__current_attempt").get(
                source_instruction=proposal
            )
            attempt = execution.operation.current_attempt
            raw = bytes(attempt.raw_transaction)
            self.assertEqual(execution.operation.status, "confirmed")
            self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).status, "paid")
            with self.assertRaises(SubscriptionRefusedException):
                record_refund(self.subscription, Decimal("65.00"), reference="UNCERTAIN-MINT")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        revoke_company_appointment(requester=self.owner, appointment_id=applying.pk)
        with patch.object(BaseChainClient, "send_raw_transaction", side_effect=AssertionError("Original paid receipt")):
            self.assertTrue(allot_subscription_task(**arguments)["success"])
        with use_operator():
            subscription = Subscription.objects.get(pk=self.subscription.pk)
            self.assertEqual(subscription.status, "allotted")
            self.assertEqual(subscription.issuance_request_id, proposal.request_id)
            self.assertEqual(SignedAttempt.objects.filter(operation_id=execution.operation_id).count(), 1)
            self.assertEqual(bytes(SignedAttempt.objects.get(pk=attempt.pk).raw_transaction), raw)
            self.assertEqual(attempt.nonce, nonce)
            self.assertEqual([effect["reason"] for effect in waiting_list(self.token.pk)], ["unlinked"])
        self.assertEqual(self.contract.functions.balanceOf(Web3.to_checksum_address(self.wallet.address)).call(), 25)
        self.assertEqual(self.chain.w3.eth.get_transaction_count(self.signer, "pending"), nonce + 1)
