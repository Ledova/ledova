from decimal import Decimal

from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from offerings.models import Subscription, SubscriptionStatus
from offerings.services.subscription import accept
from offerings.tests.test_company_eligibility_subscription_admission import (
    CompanyEligibilitySubscriptionCases,
)
from shared.db import use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.exceptions import InvestorNotEligibleException
from users.models import CompanyEligibilityDecision, InvestorCategory
from users.services.company_eligibility_consumption import (
    NO_LIVE_COMPANY_DECISION,
)


class SubscriptionEligibilityScopeTest(
    CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_a_qualified_account_subscribes(self):
        request, decision = self.accepted()
        subscription = self.submitted(quantity=2)
        self.assertEqual(subscription.status, SubscriptionStatus.SUBMITTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(request.user_account_id, self.account.pk)
        self.assert_source_unreviewed()

    def test_submit_retains_the_actual_account_company_decision_and_subscription_amount(self):
        request, decision = self.accepted()
        subscription = self.submitted(quantity=6)
        self.assertEqual(
            (
                subscription.user_account_id,
                subscription.company_id,
                subscription.eligibility_decision_id,
                subscription.quantity,
                subscription.price_per_share,
                subscription.amount_due,
                subscription.submitted_by_id,
            ),
            (self.account.pk, self.company.pk, decision.pk, 6, Decimal("2.50"), Decimal("15.00"), self.participant.pk),
        )
        self.assertEqual(request.source_id, self.source.pk)
        self.assertEqual(decision.appointment_id, self.appointment.pk)
        self.assertEqual(decision.decided_by_id, self.approver.pk)
        self.assertFalse(self.approver.is_staff)

    def test_technical_acceptance_keeps_the_submitted_account_amount_and_original_company_decision(self):
        request, decision = self.accepted()
        subscription = self.submitted(quantity=2)
        before = self.subscription_snapshot(subscription)
        with use_operator(), _requester_principal(self.technical.pk):
            accept(subscription)
            subscription.refresh_from_db()
        after = self.subscription_snapshot(subscription)
        self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertIsNotNone(subscription.accepted_at)
        for field in (
            "user_account_id",
            "company_id",
            "offering_id",
            "wallet_id",
            "quantity",
            "price_per_share",
            "amount_due",
            "currency",
            "eligibility_decision_id",
            "submitted_by_id",
            "submitted_at",
        ):
            with self.subTest(field=field):
                self.assertEqual(after[field], before[field])
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(request.user_account_id, subscription.user_account_id)
        self.assert_source_unreviewed()

    def test_a_product_value_claim_below_the_threshold_cannot_subscribe(self):
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        preview = self.preview(offering=str(self.offer.pk), quantity=10)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canSubmit"])
        self.assertEqual(preview.json()["unmetRequirements"], ["product_context_invalid"])
        requested = self.create(offering=str(self.offer.pk), quantity=10)
        self.assertEqual(requested.status_code, 400, requested.content)
        self.assertEqual(requested.json()["unmetRequirements"], ["product_context_invalid"])
        with self.assertRaises(InvestorNotEligibleException) as raised:
            self.draft(quantity=10)
        self.assertEqual(raised.exception.reasons, (NO_LIVE_COMPANY_DECISION,))
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.filter(request__source=self.source).exists())
            self.assertFalse(Subscription.objects.filter(user_account=self.account).exists())
        self.assert_source_unreviewed()

    def test_an_association_with_another_issuer_does_not_reach_this_offering(self):
        other, initial = self.company_fixture("Subscription Other Pty Ltd", "004085616")
        self.set_issuer_directory_visibility(other, True)
        self.replace_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(other.pk))
        with self.company_context(other, initial):
            self.approver, _, self.appointment = self.appointee("subscription-other-approver", ["prepare", "approve"])
            request, decision = self.accepted()
        self.assertEqual(request.company_id, other.pk)
        self.assertEqual(request.user_account_id, self.account.pk)
        self.assertEqual(decision.outcome, "accepted")
        with self.assertRaises(InvestorNotEligibleException) as raised:
            self.draft()
        self.assertEqual(raised.exception.reasons, (NO_LIVE_COMPANY_DECISION,))
        with use_operator():
            self.assertFalse(Subscription.objects.filter(user_account=self.account).exists())
        self.assert_source_unreviewed()
