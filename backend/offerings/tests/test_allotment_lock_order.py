from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from django.db import connections
from rest_framework.exceptions import ValidationError

from offerings.models import Subscription, SubscriptionStatus
from offerings.services.subscription import scale_back
from offerings.tests.test_allotment import CompanyAllotmentTestCase
from shared.db import atomic, use_migrate, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RequestStatus, ShareIssuanceRequest


class AllotmentLockOrderTest(CompanyAllotmentTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self._cap(self.offering, 4)
            scale_back(self.offering)
        self.proposal = self.prepare_paid_issue()
        self.paid_decide(self.proposal, "approve")

    def issue(self):
        proposal, _ = self.paid_decide(self.proposal, "apply")
        return proposal.request_id

    def check_prefix(self, row, *, free=(), held=()):
        result = self.while_row_is_held(self.issue, row, free=free, held=held)
        with use_operator():
            current = Subscription.objects.get(pk=self.subscription.pk)
            request = ShareIssuanceRequest.objects.get(pk=current.issuance_request_id)
            self.assertEqual(ShareIssuanceRequest.objects.filter(token=self.token).count(), 1)
        self.assertEqual(
            (current.status, current.amount_received, current.amount_due),
            (SubscriptionStatus.PAID, Decimal("25.00"), Decimal("25.00")),
        )
        self.assertEqual(
            (request.amount, request.status, request.reviewed_by_id), (4, RequestStatus.APPROVED, self.owner.pk)
        )
        self.assertEqual(request.recipient_address, self.wallet.address.lower())
        self.assertEqual(result, request.pk)

    def test_single_allotment_waits_on_company_before_token_and_offering(self):
        self.check_prefix(self.company, free=(self.token, self.offering, self.subscription))

    def test_busy_class_refuses_admission_without_an_effect_and_recovers_after_release(self):
        def attempt():
            connections.close_all()
            try:
                with use_operator(), self.assertRaises(ValidationError) as refused:
                    self.issue()
                return refused.exception.detail
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                type(self.token).objects.select_for_update().get(pk=self.token.pk)
                result = pool.submit(attempt).result(timeout=5)
                self.assertEqual(result["unmet_requirements"], ["source_lock_busy"])
                self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())
                self.subscription.refresh_from_db()
                self.assertIsNone(self.subscription.issuance_request_id)
            request = self.issue()
        with use_operator():
            self.subscription.refresh_from_db()
            self.assertEqual(self.subscription.issuance_request_id, request)
            self.assertEqual(ShareIssuanceRequest.objects.filter(token=self.token).count(), 1)

    def test_single_allotment_holds_company_and_token_before_offering(self):
        self.check_prefix(self.offering, free=(self.subscription,), held=(self.company, self.token))


class ScopedAllotmentLockOrderTest(RunsOnTheScopedConnection, AllotmentLockOrderTest):
    pass
