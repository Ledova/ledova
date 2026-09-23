from datetime import timedelta

from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import use_operator
from tokens.models import SwapOrder, SwapOrderStatus
from tokens.services import swap_execution
from tokens.tests.order_submission_fixtures import SubmissionFixtures
from tokens.tests.swap_execution_fixtures import make_execution
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER
from users.constants import ACCOUNT_STATUS_SUSPENDED
from users.exceptions import InvestorNotEligibleException
from users.models import (
    InvestorClassification,
    InvestorClassificationStatus,
    UserAccount,
)


class ListingRequiresALiveClassificationTest(SubmissionFixtures, APITransactionTestCase):
    def lapse(self, **changes):
        with use_operator():
            InvestorClassification.objects.filter(user_account=self.tenant.account).update(**changes)

    def test_a_live_classification_lets_the_listing_through(self):
        response = self.create(self.signed_body())

        self.assertEqual(response.status_code, 201, response.content)

    def test_a_revoked_classification_records_the_eligibility_refusal(self):
        signed = self.signed_body()
        self.lapse(status=InvestorClassificationStatus.REVOKED)

        response = self.create(signed)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "investor_not_eligible")
        self.assertEqual(self.submission(signed["submission_id"]).refusal_code, "investor_not_eligible")
        self.assertIn("no_live_classification", self.submission(signed["submission_id"]).refusal_detail)
        self.whitelist.is_whitelisted.assert_called()

    def test_an_expired_classification_records_the_same_refusal(self):
        signed = self.signed_body()
        self.lapse(expires_at=timezone.now() - timedelta(seconds=1))

        response = self.create(signed)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "investor_not_eligible")

    def test_a_suspended_account_records_the_same_refusal(self):
        signed = self.signed_body()
        with use_operator():
            UserAccount.objects.filter(pk=self.tenant.account.pk).update(account_status=ACCOUNT_STATUS_SUSPENDED)

        response = self.create(signed)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "investor_not_eligible")


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class AcceptanceRequiresALiveClassificationTest(TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.fixture = make_execution("stage-acceptance")

    def sign(self, participant):
        key = SELLER if participant == "seller" else BUYER
        return swap_execution.submit_signature(
            self.fixture.swap,
            self.fixture.signatures[participant],
            key.address,
            user=getattr(self.fixture, participant).user,
            participant=participant,
        )

    def stored(self):
        with use_operator():
            swap = SwapOrder.objects.get(pk=self.fixture.swap.pk)
        return (swap.status, swap.seller_signature, swap.buyer_signature)

    def revoke(self, tenant):
        with use_operator():
            InvestorClassification.objects.filter(user_account=tenant.account).update(
                status=InvestorClassificationStatus.REVOKED
            )

    def test_a_party_whose_classification_was_revoked_cannot_accept(self):
        self.revoke(self.fixture.seller)
        before = self.stored()

        with self.assertRaises(InvestorNotEligibleException) as refusal:
            self.sign("seller")

        self.assertIn("no_live_classification", str(refusal.exception.detail))
        self.assertEqual(self.stored(), before)

    def test_a_relayed_signature_is_judged_by_whose_signature_it_is(self):
        self.revoke(self.fixture.seller)
        before = self.stored()

        with self.assertRaises(InvestorNotEligibleException) as refusal:
            swap_execution.submit_signature(
                self.fixture.swap,
                self.fixture.signatures["seller"],
                SELLER.address,
                user=self.fixture.buyer.user,
                participant="buyer",
            )

        self.assertIn("no_live_classification", str(refusal.exception.detail))
        self.assertEqual(self.stored(), before)

    def test_a_buyer_may_still_relay_a_live_sellers_signature(self):
        swap_execution.submit_signature(
            self.fixture.swap,
            self.fixture.signatures["seller"],
            SELLER.address,
            user=self.fixture.buyer.user,
            participant="buyer",
        )

        status, seller_signature, _ = self.stored()
        self.assertEqual(status, SwapOrderStatus.SELLER_SIGNED)
        self.assertNotEqual(seller_signature, "")

    def test_the_counterparty_with_a_live_classification_still_signs(self):
        self.revoke(self.fixture.seller)

        self.sign("buyer")

        status, seller_signature, buyer_signature = self.stored()
        self.assertEqual(status, SwapOrderStatus.BUYER_SIGNED)
        self.assertEqual(seller_signature, "")
        self.assertNotEqual(buyer_signature, "")
