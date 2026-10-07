from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import ShareIssuanceExecution, ShareIssuanceRequest
from tokens.services import issuance_execution
from tokens.tasks import check_executing_issuance_requests, execute_review_request_task
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY, admit, install_issuance


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ScopedIssuanceExecutionTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        install_issuance(self)

    def test_issuer_and_staff_app_roles_cannot_read_or_admit_private_execution(self):
        with use_operator():
            command = admit(self.request, self.actor)
        for user in (self.company_issue.participant, self.actor):
            with acting_for(user.pk):
                with self.assertRaises(PermissionDenied):
                    issuance_execution.confirmation(self.request, self.actor)
                with self.assertRaises(PermissionDenied):
                    issuance_execution.recover(command.pk)
                with self.assertRaises(DatabaseError), atomic():
                    ShareIssuanceExecution.objects.filter(pk=command.pk).exists()
        self.node.client.send_raw_transaction.assert_not_called()

    def test_issuer_pending_request_edits_supply_no_private_admission(self):
        with acting_for(self.tenant.user.pk):
            request = ShareIssuanceRequest.objects.create(
                token=self.token, recipient_address=self.tenant.wallet.address, amount=2, reason="Additional request"
            )
            self.assertIsNotNone(request.dispatch_id)
            request.amount = 3
            request.save(update_fields=["amount"])
            with self.assertRaises(PermissionDenied):
                issuance_execution.confirmation(request, self.actor)
            request.delete()
            self.assertFalse(ShareIssuanceRequest.objects.filter(pk=request.pk).exists())
        with use_operator():
            self.assertFalse(ShareIssuanceExecution.objects.exists())
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, "under_review")

    def test_stale_issuer_cannot_retarget_or_claim_an_admitted_issuance(self):
        with use_operator():
            command = admit(self.request, self.actor)
        with acting_for(self.tenant.user.pk):
            for changes in (
                {"amount": 999},
                {"dispatch_id": None},
                {"status": "executed"},
                {"executed_at": timezone.now()},
                {"review_notes": "Public operator notes"},
            ):
                with self.assertRaises(DatabaseError), atomic():
                    ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(**changes)
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).amount, 10)
        with use_operator():
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")

    def test_operator_job_from_app_context_uses_committed_operator_connection_and_original_identity(self):
        with use_operator():
            command = admit(self.request, self.actor)
        original_send = self.node.send

        def send(raw):
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            self.assertTrue(connections[OPERATOR_ALIAS].get_autocommit())
            self.assertFalse(connections[OPERATOR_ALIAS].in_atomic_block)
            return original_send(raw)

        self.node.client.send_raw_transaction.side_effect = send
        with acting_for(self.tenant.user.pk):
            bad = execute_review_request_task(
                model_label="tokens.ShareIssuanceRequest",
                request_uuid=str(self.request.pk),
                executed_by=self.company_issue.participant.pk,
                execution_id=str(command.pk),
            )
            self.assertFalse(bad["success"])
            self.node.client.send_raw_transaction.assert_not_called()
            result = execute_review_request_task(
                model_label="tokens.ShareIssuanceRequest",
                request_uuid=str(self.request.pk),
                executed_by=self.actor.pk,
                execution_id=str(command.pk),
            )
            self.assertTrue(result["success"])
            self.assertEqual(current_alias(), APP_ALIAS)
        with use_operator():
            self.assertEqual(self.operations.count(), 1)

    def test_old_job_without_admission_cannot_create_a_new_operator_mint(self):
        with acting_for(self.tenant.user.pk):
            result = execute_review_request_task(
                model_label="tokens.ShareIssuanceRequest", request_uuid=str(self.request.pk), executed_by=self.actor.pk
            )
        self.assertFalse(result["success"])
        self.node.client.assert_expected_chain.assert_not_called()
        with use_operator():
            self.assertFalse(ShareIssuanceExecution.objects.exists())
            self.assertFalse(self.operations.exists())

    def test_operator_job_from_app_context_holds_until_finality_without_locks_during_rpc(self):
        with use_operator():
            command = admit(self.request, self.actor)
        original = self.node.block
        observations = []

        def block(identifier):
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            self.assertTrue(connections[OPERATOR_ALIAS].get_autocommit())
            self.assertFalse(connections[OPERATOR_ALIAS].in_atomic_block)
            observations.append(identifier)
            return original(identifier)

        self.node.client.w3.eth.get_block.side_effect = block
        self.node.finalized = self.node.receipt_height - 1
        with acting_for(self.tenant.user.pk):
            pending = execute_review_request_task(
                model_label="tokens.ShareIssuanceRequest",
                request_uuid=str(self.request.pk),
                executed_by=self.actor.pk,
                execution_id=str(command.pk),
            )
            self.assertEqual((pending["success"], pending["status"]), (False, "executing"))
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, "executing")
            self.node.finalized = self.node.receipt_height
            self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 1})
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, "executed")
            self.assertEqual(current_alias(), APP_ALIAS)
        self.assertIn("finalized", observations)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_subscriber_cannot_retarget_delete_or_fake_refund_after_admission(self):
        from decimal import Decimal
        from unittest.mock import patch

        from companies.services.editing import update_company
        from offerings.models import Offering, OfferingExemption, Subscription
        from offerings.services.offering import submit_offering, transition_offering
        from offerings.services.subscription import record_refund
        from offerings.tests.factories import (
            configure_operator,
            subscription_technical_actor,
        )
        from tokens.services.register_paid_issues import prepare_paid_issue
        from tokens.tests.company_paid_issue_fixtures import CompanyPaidIssueCases

        fixture = self.company_issue
        fixture.company = update_company(fixture.company, {"is_open_to_investors": True}, actor=fixture.owner)
        with use_operator():
            configure_operator()
            fixture.technical = subscription_technical_actor()
            fixture.offer = Offering.objects.create(
                token=fixture.token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=Decimal("2.50"),
                minimum_shares=1,
                target_shares=100,
                cap_shares=100,
                maximum_shares=100,
                opens_at=timezone.now(),
                summary="Exact paid subscriber guard terms",
            )
            submit_offering(fixture.offer, submitted_by=fixture.owner)
            transition_offering(fixture.offer, "approve", reviewed_by=fixture.technical)
            fixture.offer.refresh_from_db()
        self.enterContext(patch("tokens.services.register_paid_issues.chain_snapshot", return_value=(100, 0, 0)))
        self.enterContext(patch("tokens.services.issuance_execution._enqueue"))
        fixture.subscription = subscription = CompanyPaidIssueCases.genuine_paid_subscription(fixture, quantity=10)
        with acting_for(fixture.participant.pk):
            Subscription.objects.filter(pk=subscription.pk).update(payment_notes="Investor payment note")
            self.assertEqual(Subscription.objects.get(pk=subscription.pk).payment_notes, "Investor payment note")
        proposal = prepare_paid_issue(**CompanyPaidIssueCases.paid_payload(fixture))
        CompanyPaidIssueCases.paid_decide(fixture, proposal, "approve")
        proposal, _ = CompanyPaidIssueCases.paid_decide(fixture, proposal, "apply")
        with use_operator():
            request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
            command = ShareIssuanceExecution.objects.get(request_id=request.pk)
        with acting_for(fixture.participant.pk):
            self.assertTrue(ShareIssuanceRequest.objects.filter(pk=request.pk).exists())
            for fields in (
                {"issuance_request": None},
                {"amount_received": Decimal("1.00")},
                {"allotted_quantity": 999},
                {"status": "refunded"},
                {"refunded_at": timezone.now()},
            ):
                with self.assertRaises(DatabaseError), atomic():
                    Subscription.objects.filter(pk=subscription.pk).update(**fields)
            with self.assertRaises(DatabaseError), atomic():
                Subscription.objects.filter(pk=subscription.pk).delete()
            self.assertEqual(Subscription.objects.get(pk=subscription.pk).status, "paid")
        with use_operator():
            record_refund(subscription, Decimal("1.00"))
            command.refresh_from_db()
            self.assertEqual(command.status, "cancelled")
        with acting_for(fixture.participant.pk):
            from offerings.tasks import allot_subscription_task

            result = allot_subscription_task(
                str(subscription.pk), executed_by=fixture.owner.pk, execution_id=str(command.pk)
            )
            self.assertEqual(result["status"], "rejected")
            self.assertEqual(current_alias(), APP_ALIAS)
        fixture.issuance_node.client.send_raw_transaction.assert_not_called()
