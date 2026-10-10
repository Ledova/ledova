from django.test import TestCase

from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import use_operator
from users.constants import (
    ACCOUNT_STATUS_ACTIVE,
    ACCOUNT_STATUS_PENDING,
    ACCOUNT_STATUS_REJECTED,
    ACCOUNT_STATUS_SUSPENDED,
    ACCOUNT_STATUS_TERMINATED,
)
from users.services.eligibility import (
    ACCOUNT_NOT_IN_GOOD_STANDING,
    IDENTITY_NOT_VERIFIED,
    investor_readiness,
)
from users.tests.factories import make_investor


class AccountStandingMatrixTest(TestCase):
    def _standing(self, label, account_status, kyc_required, id_verified=True):
        with use_operator():
            operator = Operator.get()
            operator.investor_kyc_required = kyc_required
            operator.save(update_fields=["investor_kyc_required"])
            user, account = make_investor(label, account_status=account_status, id_verified=id_verified)
            with _requester_principal(user.pk):
                outcome = investor_readiness(user)
        self.assertEqual(outcome.account, account)
        return outcome

    def test_refused_statuses_are_refused_whether_or_not_kyc_is_required(self):
        for kyc_required in (True, False):
            for account_status in (ACCOUNT_STATUS_REJECTED, ACCOUNT_STATUS_SUSPENDED, ACCOUNT_STATUS_TERMINATED):
                with self.subTest(kyc_required=kyc_required, account_status=account_status):
                    outcome = self._standing(f"{account_status}-{kyc_required}", account_status, kyc_required)
                    self.assertFalse(outcome.is_ready)
                    self.assertEqual(outcome.reasons, (ACCOUNT_NOT_IN_GOOD_STANDING,))

    def test_active_is_ready_whether_or_not_kyc_is_required(self):
        for kyc_required in (True, False):
            with self.subTest(kyc_required=kyc_required):
                outcome = self._standing(f"active-{kyc_required}", ACCOUNT_STATUS_ACTIVE, kyc_required)
                self.assertTrue(outcome.is_ready, outcome.reasons)

    def test_pending_is_refused_while_investor_kyc_is_required(self):
        outcome = self._standing("pending-on", ACCOUNT_STATUS_PENDING, True)

        self.assertFalse(outcome.is_ready)
        self.assertEqual(outcome.reasons, (ACCOUNT_NOT_IN_GOOD_STANDING,))

    def test_pending_is_ready_on_a_kyc_off_deployment(self):
        outcome = self._standing("pending-off", ACCOUNT_STATUS_PENDING, False, id_verified=False)

        self.assertTrue(outcome.is_ready, outcome.reasons)

    def test_an_unverified_holder_is_refused_only_while_kyc_is_required(self):
        refused = self._standing("unverified-on", ACCOUNT_STATUS_ACTIVE, True, id_verified=False)
        allowed = self._standing("unverified-off", ACCOUNT_STATUS_ACTIVE, False, id_verified=False)

        self.assertFalse(refused.is_ready)
        self.assertEqual(refused.reasons, (IDENTITY_NOT_VERIFIED,))
        self.assertTrue(allowed.is_ready, allowed.reasons)
