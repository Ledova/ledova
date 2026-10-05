from unittest.mock import patch
from uuid import uuid4

from django.test import TransactionTestCase, override_settings
from rest_framework.test import APITransactionTestCase

from shared.db import acting_for, use_operator
from tokens.exceptions import SwapSignatureException
from tokens.models import SwapOrder, SwapOrderStatus
from tokens.services import swap_execution
from tokens.tests.order_submission_fixtures import SubmissionFixtures
from tokens.tests.swap_execution_fixtures import make_execution
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER
from users.constants import ACCOUNT_STATUS_SUSPENDED
from users.exceptions import InvestorNotEligibleException
from users.models import UserAccount
from users.services.company_eligibility import revoke_eligibility_decision


def revoke(decision):
    with use_operator():
        actor = decision.decided_by
        company_id = decision.request.company_id
    with acting_for(actor.pk):
        revoke_eligibility_decision(
            actor=actor,
            request_id=decision.request_id,
            company_id=company_id,
            appointment=decision.appointment_id,
            idempotency_key=uuid4(),
            reason="Synthetic company revocation before a new trading effect",
        )


class ListingRequiresALiveClassificationTest(SubmissionFixtures, APITransactionTestCase):
    def test_a_live_company_decision_lets_the_listing_through(self):
        response = self.create(self.signed_body())
        self.assertEqual(response.status_code, 201, response.content)

    def test_a_revoked_company_decision_records_the_eligibility_refusal(self):
        signed = self.signed_body()
        revoke(self.eligibility_decision)
        response = self.create(signed)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "investor_not_eligible")
        refused = self.submission(signed["submission_id"])
        self.assertEqual(refused.refusal_code, "investor_not_eligible")
        self.assertIn("no_live_company_decision", refused.refusal_detail)
        self.whitelist.is_whitelisted.assert_called()

    def test_an_expired_company_decision_records_the_same_refusal(self):
        with patch("django.utils.timezone.now", return_value=self.eligibility_decision.expires_at):
            signed = self.signed_body()
            response = self.create(signed)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "investor_not_eligible")
        self.assertIn("no_live_company_decision", response.json()["refusal"]["detail"])

    def test_a_suspended_account_records_the_same_refusal(self):
        signed = self.signed_body()
        with use_operator():
            UserAccount.objects.filter(pk=self.tenant.account.pk).update(account_status=ACCOUNT_STATUS_SUSPENDED)
        response = self.create(signed)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "investor_not_eligible")
        self.assertIn("no_live_company_decision", response.json()["refusal"]["detail"])


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class AcceptanceRequiresALiveClassificationTest(TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.fixture = make_execution("stage-acceptance")

    def sign(self, participant):
        key = SELLER if participant == "seller" else BUYER
        with acting_for(getattr(self.fixture, participant).user.pk):
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

    def test_a_party_whose_company_decision_was_revoked_cannot_accept(self):
        revoke(self.fixture.eligibility["seller"])
        before = self.stored()
        with self.assertRaises(InvestorNotEligibleException) as refusal:
            self.sign("seller")
        self.assertIn("no_live_company_decision", str(refusal.exception.detail))
        self.assertEqual(self.stored(), before)

    def test_a_fresh_seller_signature_cannot_be_submitted_as_the_buyer(self):
        before = self.stored()
        with acting_for(self.fixture.buyer.user.pk), self.assertRaises(SwapSignatureException):
            swap_execution.submit_signature(
                self.fixture.swap,
                self.fixture.signatures["seller"],
                SELLER.address,
                user=self.fixture.buyer.user,
                participant="buyer",
            )
        self.assertEqual(self.stored(), before)

    def test_a_live_seller_and_buyer_sign_for_themselves(self):
        self.sign("seller")
        self.assertEqual(self.stored(), (SwapOrderStatus.SELLER_SIGNED, self.fixture.signatures["seller"], ""))
        self.sign("buyer")
        status, seller_signature, buyer_signature = self.stored()
        self.assertEqual(status, SwapOrderStatus.READY)
        self.assertEqual(seller_signature, self.fixture.signatures["seller"])
        self.assertEqual(buyer_signature, self.fixture.signatures["buyer"])

    def test_the_counterparty_with_a_live_company_decision_still_signs(self):
        revoke(self.fixture.eligibility["seller"])
        self.sign("buyer")
        status, seller_signature, buyer_signature = self.stored()
        self.assertEqual(status, SwapOrderStatus.BUYER_SIGNED)
        self.assertEqual(seller_signature, "")
        self.assertEqual(buyer_signature, self.fixture.signatures["buyer"])
