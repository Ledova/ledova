from decimal import Decimal
from unittest.mock import patch

from django.db import DatabaseError
from rest_framework.test import APITransactionTestCase

from blockchain.models import OutgoingOperation, SignedAttempt
from offerings.exceptions import SubscriptionRefusedException
from offerings.models import Subscription
from offerings.services.subscription import record_refund
from offerings.tasks import allot_subscription_task
from shared.db import atomic
from tokens.models import (
    RequestStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution
from tokens.tests.company_paid_issue_fixtures import CompanyPaidIssueCases


class QueuedIssuanceTermsTest(CompanyPaidIssueCases, APITransactionTestCase):
    def genuine_paid_subscription(self, *, quantity=10, received=None, final=False):
        return super().genuine_paid_subscription(quantity=quantity, received=received, final=final)

    def setUp(self):
        super().setUp()
        self.proposal = self.applied_paid_issue()
        self.operator = self.owner
        self.request = ShareIssuanceRequest.objects.get(pk=self.proposal.request_id)
        self.assertEqual(self.request.status, RequestStatus.APPROVED)
        self.assertEqual(self.request.amount, 10)
        self.operations = OutgoingOperation.objects.filter(
            operation_key=f"share-issuance:{self.request.pk}:{self.request.dispatch_id}"
        )
        self.attempts = SignedAttempt.objects.filter(operation__in=self.operations)

    def test_queued_amount_cannot_be_changed_after_allotment(self):
        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(amount=999)
        self.request.refresh_from_db()
        self.assertEqual(self.request.amount, 10)

    def test_queued_subscription_cannot_discard_its_issuance(self):
        with self.assertRaises(DatabaseError), atomic():
            Subscription.objects.filter(pk=self.subscription.pk).update(issuance_request=None)
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.issuance_request_id, self.request.pk)

    def test_a_refund_cannot_be_undone_by_reapproving_the_queued_request(self):
        record_refund(self.subscription, Decimal("1.00"), reference="synthetic-refund")
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.REJECTED)
        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(status=RequestStatus.APPROVED)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.REJECTED)

    def test_delayed_job_after_refund_cannot_create_an_operation_or_public_mint(self):
        command = ShareIssuanceExecution.objects.get(request_id=self.request.pk)
        record_refund(self.subscription, Decimal("1.00"))
        with patch("tokens.services.issuance_execution.get_base_chain_client") as client:
            result = allot_subscription_task(
                str(self.subscription.pk), executed_by=self.operator.pk, execution_id=str(command.pk)
            )
        client.assert_not_called()
        self.assertFalse(result["success"])
        self.assertEqual(result["status"], RequestStatus.REJECTED)
        self.assertFalse(self.operations.exists())
        self.assertFalse(self.attempts.exists())
        self.assertFalse(ShareIssuance.objects.exists())
        command.refresh_from_db()
        self.assertEqual(command.status, "cancelled")

    def test_invalid_refund_rolls_back_its_cancellation_and_request_rejection(self):
        with self.assertRaises(SubscriptionRefusedException):
            record_refund(self.subscription, Decimal("10000.00"))
        self.subscription.refresh_from_db()
        self.request.refresh_from_db()
        self.assertEqual(self.subscription.status, "paid")
        self.assertIsNone(self.subscription.refunded_at)
        self.assertEqual(self.request.status, "approved")
        self.assertEqual(ShareIssuanceExecution.objects.get().status, "queued")

    def test_execution_claim_prevents_refund_before_an_operation_exists(self):
        command = issuance_execution._start(ShareIssuanceExecution.objects.get())
        self.assertEqual(command.status, "executing")
        self.assertFalse(self.operations.exists())
        with self.assertRaises(SubscriptionRefusedException):
            record_refund(self.subscription, Decimal("1.00"))
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.status, "paid")
        self.assertIsNone(self.subscription.refunded_at)

    def test_queued_subscription_cannot_fake_a_refund_or_public_execution(self):
        with self.assertRaises(DatabaseError), atomic():
            Subscription.objects.filter(pk=self.subscription.pk).update(status="refunded")
        from django.utils import timezone

        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(executed_at=timezone.now())
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.status, "paid")

    def test_recorded_refund_cannot_be_cleared_reduced_or_restore_paid(self):
        record_refund(self.subscription, Decimal("5.00"))
        for fields in ({"refunded_at": None}, {"refund_amount": Decimal("1.00")}, {"status": "paid"}):
            with self.assertRaises(DatabaseError), atomic():
                Subscription.objects.filter(pk=self.subscription.pk).update(**fields)
        record_refund(self.subscription, Decimal("1.00"))
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.refunded_total, Decimal("6.00"))
