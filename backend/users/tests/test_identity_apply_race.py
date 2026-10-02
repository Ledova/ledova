from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from compliance.models import CustomerRiskAssessment
from integrations.kyc.base import NormalizedVerificationResult
from integrations.kycaid.client import KYCAIDService
from integrations.tests.kycaid_payloads import (
    API_TOKEN,
    APPLICANT_ID,
    applicant,
    signed,
    verification_completed,
)
from shared.db import current_alias, set_principal, use_operator
from shared.models import Country
from shared.tests.scoped import RunsOnTheScopedConnection
from users.models import UserAccount, UserProfile
from users.services.identity import IdentityVerificationService

User = get_user_model()
PUSH_TASK = "users.tasks.notifications.send_push_notification"


def a_profile_awaiting_its_result(email):
    user = User.objects.create_user(email=email, password="pw-12345678")
    profile = UserProfile.objects.create(
        user=user,
        kycaid_applicant_id=APPLICANT_ID,
        verification_status="pending",
        citizenship_country=Country.get_or_create_for_code("AU"),
    )
    UserAccount.objects.create(account_number=f"ACC-{user.pk:06d}", user_profile=profile)
    return profile


def an_approval():
    return NormalizedVerificationResult(verification_status="completed", review_result="GREEN", is_verified=True)


class ScopedIdentityApplyRaceTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.profile = a_profile_awaiting_its_result("apply-race@example.test")

    def test_a_webhook_and_a_poll_applying_one_approval_together_process_it_once(self):
        process = IdentityVerificationService._process_verified_customer
        arrivals, guard, second = [], Lock(), Event()

        def contended(user_profile, pep_data):
            with guard:
                arrivals.append(user_profile.pk)
                first = len(arrivals) == 1
            if first:
                second.wait(timeout=2)
            else:
                second.set()
            return process(user_profile, pep_data)

        def as_the_webhook():
            with use_operator():
                IdentityVerificationService.update_status_from_normalized(
                    UserProfile.objects.get(pk=self.profile.pk), an_approval()
                )

        def as_the_poll():
            set_principal(self.profile.user_id, current_alias())
            IdentityVerificationService.update_status_from_normalized(
                UserProfile.objects.get(pk=self.profile.pk), an_approval()
            )

        def run(apply):
            try:
                apply()
            finally:
                connections.close_all()

        with patch.object(IdentityVerificationService, "_process_verified_customer", side_effect=contended), patch(
            PUSH_TASK
        ) as push_task:
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(run, (as_the_webhook, as_the_poll)))

        with use_operator():
            assessments = CustomerRiskAssessment.objects.filter(
                user_account__user_profile=self.profile, assessment_status="complete"
            )
            self.assertEqual(assessments.count(), 1)
            self.assertTrue(UserProfile.objects.get(pk=self.profile.pk).is_id_verified)
        self.assertEqual(push_task.defer.call_count, 1)


@override_settings(KYCAID_API_TOKEN=API_TOKEN, KYC_PROVIDER="kycaid")
class ProviderCallsOutsideTheApplyTransactionTest(TransactionTestCase):
    def setUp(self):
        self.profile = a_profile_awaiting_its_result("outside-the-lock@example.test")
        self.client = APIClient()
        self.calls = []
        push = patch(PUSH_TASK)
        push.start()
        self.addCleanup(push.stop)

    def provider_answers(self, record):
        def answer(applicant_id):
            self.calls.append([alias for alias in connections if connections[alias].in_atomic_block])
            return record

        return answer

    def test_the_webhook_reads_the_applicant_record_outside_any_transaction(self):
        body, signature = signed(verification_completed())

        with patch.object(KYCAIDService, "get_applicant_data", side_effect=self.provider_answers(applicant())):
            response = self.client.post(
                reverse("kycaid-webhook"), body, content_type="application/json", HTTP_X_DATA_INTEGRITY=signature
            )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.calls, [[]])
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_id_verified)

    def test_the_poll_reads_the_applicant_record_outside_any_transaction(self):
        self.client.force_authenticate(self.profile.user)
        record = applicant(verification_status="valid")

        with patch.object(
            KYCAIDService, "get_applicant_status", side_effect=self.provider_answers(record)
        ), patch.object(KYCAIDService, "get_applicant_data", side_effect=self.provider_answers(record)):
            response = self.client.get("/api/users/identity-verification/status/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.calls, [[], []])
        self.assertTrue(response.json()["isVerified"])
