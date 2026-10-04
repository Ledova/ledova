from decimal import Decimal

from offerings.models import Subscription, SubscriptionStatus
from offerings.services.subscription import allot, allot_batch
from offerings.tests import test_allotment as fixtures
from offerings.tests.factories import allottable_subscription
from shared.db import use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RequestStatus, ShareIssuanceRequest
from users.models import UserAccount


class AllotmentLockOrderTest(RealRowContention, fixtures.AllotmentTestCase):
    def setUp(self):
        with use_operator():
            super().setUp()
            self.subscription = allottable_subscription(self.tenant, quantity=10, allotted=4)
            self.company = self.offering.token.company
            self.token = self.offering.token

    def issue(self, *, batch=False):
        current = Subscription.objects.get(pk=self.subscription.pk)
        if batch:
            return allot_batch([current], self.operator_user)
        return allot(current, self.operator_user).pk

    def check_prefix(self, row, *, free=(), held=(), batch=False):
        result = self.while_row_is_held(lambda: self.issue(batch=batch), row, free=free, held=held)
        with use_operator():
            current = Subscription.objects.get(pk=self.subscription.pk)
            request = ShareIssuanceRequest.objects.get(pk=current.issuance_request_id)
            self.assertEqual(ShareIssuanceRequest.objects.filter(token=self.token).count(), 1)
        self.assertEqual(
            (current.status, current.amount_received, current.amount_due),
            (SubscriptionStatus.PAID, Decimal("25.00"), Decimal("25.00")),
        )
        self.assertEqual(
            (request.amount, request.status, request.reviewed_by_id), (4, RequestStatus.APPROVED, self.operator_user.pk)
        )
        self.assertEqual(request.recipient_address, self.tenant.wallet.address)
        self.assertEqual(self.defer.call_count, 1)
        if batch:
            self.assertEqual(result, {"allotted": 1, "refusals": []})
        else:
            self.assertEqual(result, request.pk)

    def test_single_allotment_waits_on_company_before_token_and_offering(self):
        self.check_prefix(self.company, free=(self.token, self.offering, self.subscription))

    def test_single_allotment_holds_company_before_token(self):
        self.check_prefix(self.token, free=(self.offering, self.subscription), held=(self.company,))

    def test_single_allotment_holds_company_and_token_before_offering(self):
        self.check_prefix(self.offering, free=(self.subscription,), held=(self.company, self.token))

    def test_batch_allotment_waits_on_company_before_token_and_offering(self):
        self.check_prefix(self.company, free=(self.token, self.offering, self.subscription), batch=True)

    def test_batch_allotment_holds_company_before_token(self):
        self.check_prefix(self.token, free=(self.offering, self.subscription), held=(self.company,), batch=True)

    def test_batch_allotment_holds_company_and_token_before_offering(self):
        self.check_prefix(self.offering, free=(self.subscription,), held=(self.company, self.token), batch=True)

    def test_paid_instructed_allotment_preserves_its_admission_after_account_standing_changes(self):
        def reject():
            UserAccount.objects.filter(pk=self.tenant.account.pk).update(account_status="rejected")

        result = self.while_row_is_held(lambda: self.issue(), self.company, after_wait=reject)
        with use_operator():
            current = Subscription.objects.get(pk=self.subscription.pk)
            request = ShareIssuanceRequest.objects.get(pk=result)
        self.assertEqual((current.status, current.issuance_request_id), (SubscriptionStatus.PAID, request.pk))
        self.assertEqual(request.amount, 4)


class ScopedAllotmentLockOrderTest(RunsOnTheScopedConnection, AllotmentLockOrderTest):
    pass
