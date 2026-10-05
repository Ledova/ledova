from unittest.mock import patch

import requests
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from compliance.models import CustomerRiskAssessment
from integrations.kycaid.client import KYCAIDService
from integrations.tests.kycaid_payloads import (
    API_TOKEN,
    APPLICANT_ID,
    DOCUMENTED_VERIFICATION_STATUSES,
    applicant,
    signed,
    status_changed,
    verification_completed,
)
from operators.models import Operator
from shared.models import Country
from users.models import UserAccount, UserProfile

User = get_user_model()


@override_settings(KYCAID_API_TOKEN=API_TOKEN)
class KYCAIDWebhookResultTest(APITestCase):
    def setUp(self):
        Operator.get()
        self.push_task = patch("users.tasks.notifications.send_push_notification").start()
        self.addCleanup(patch.stopall)
        user = User.objects.create_user(email="kycaid-webhook@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(
            user=user,
            kycaid_applicant_id=APPLICANT_ID,
            verification_status="init",
            citizenship_country=Country.get_or_create_for_code("AU"),
        )
        self.account = UserAccount.objects.create(account_number="KYCAID-ACC", user_profile=self.profile)

    def post_event(self, payload):
        body, signature = signed(payload)
        return self.client.post(
            reverse("kycaid-webhook"), body, content_type="application/json", HTTP_X_DATA_INTEGRITY=signature
        )

    def refreshed(self):
        self.profile.refresh_from_db()
        self.account.refresh_from_db()
        return self.profile, self.account

    def test_a_status_change_records_each_documented_status_as_one_of_the_fields_choices(self):
        cases = {"unused": ("completed", "init"), "pending": ("init", "pending"), "completed": ("pending", "completed")}
        for reported in DOCUMENTED_VERIFICATION_STATUSES:
            start, expected = cases[reported]
            with self.subTest(reported=reported):
                self.profile.verification_status = start
                self.profile.save(update_fields=["verification_status"])
                response = self.post_event(status_changed(reported))
                self.assertEqual(response.status_code, 200, response.content)
                profile, _ = self.refreshed()
                self.assertEqual(profile.verification_status, expected)

    def test_an_undocumented_status_change_leaves_the_recorded_status_alone(self):
        with self.assertLogs("integrations.kycaid.webhook", level="WARNING"):
            response = self.post_event(status_changed("archived"))

        self.assertEqual(response.status_code, 200, response.content)
        profile, _ = self.refreshed()
        self.assertEqual(profile.verification_status, "init")

    def test_a_pending_verification_records_no_result(self):
        response = self.post_event(verification_completed(status="pending", verified=None))

        self.assertEqual(response.status_code, 200, response.content)
        profile, account = self.refreshed()
        self.assertEqual(profile.verification_status, "pending")
        self.assertIsNone(profile.review_result)
        self.assertFalse(UserProfile.objects.filter(review_result="").exists())
        self.assertFalse(profile.is_id_verified)
        self.assertEqual(account.account_status, "pending")
        self.push_task.defer.assert_not_called()

    def test_an_approved_pep_is_rejected_by_the_unchanged_pep_policy(self):
        with patch.object(KYCAIDService, "get_applicant_data", return_value=applicant(pep=False)) as fetch:
            response = self.post_event(verification_completed(applicant=applicant(pep=True)))

        self.assertEqual(response.status_code, 200, response.content)
        profile, account = self.refreshed()
        self.assertTrue(profile.is_id_verified)
        self.assertEqual((account.account_status, account.rejection_reason), ("rejected", "pep_policy"))
        self.assertFalse(
            CustomerRiskAssessment.objects.filter(user_account=account, assessment_status="complete").exists()
        )
        fetch.assert_called_once_with(APPLICANT_ID)

    def test_an_approval_whose_applicant_carries_no_pep_flag_reads_the_flag_from_the_applicant_record(self):
        without_the_flag = {key: value for key, value in applicant().items() if key != "pep"}
        for embedded in (
            without_the_flag,
            "an applicant that is not an object",
            [],
            applicant(pep=None),
            applicant(pep="unknown"),
            applicant(pep=0),
        ):
            with self.subTest(embedded=type(embedded).__name__):
                self.account.account_status, self.account.rejection_reason = "pending", ""
                self.account.save(update_fields=["account_status", "rejection_reason"])
                self.profile.is_id_verified, self.profile.review_result = False, None
                self.profile.save(update_fields=["is_id_verified", "review_result"])
                with patch.object(KYCAIDService, "get_applicant_data", return_value=applicant(pep=True)) as fetch:
                    response = self.post_event(verification_completed(applicant=embedded))
                self.assertEqual(response.status_code, 200, response.content)
                _, account = self.refreshed()
                self.assertEqual((account.account_status, account.rejection_reason), ("rejected", "pep_policy"))
                fetch.assert_called_once_with(APPLICANT_ID)

    def test_an_approval_with_an_uninterpretable_fetched_pep_flag_stays_pending(self):
        for flag in (None, "unknown", "", 0, 1, [], {}):
            with self.subTest(flag=flag):
                with patch.object(KYCAIDService, "get_applicant_data", return_value=applicant(pep=flag)) as fetch:
                    response = self.post_event(verification_completed())
                self.assertEqual(response.status_code, 200, response.content)
                profile, account = self.refreshed()
                self.assertFalse(profile.is_id_verified)
                self.assertEqual((profile.verification_status, profile.review_result), ("pending", None))
                self.assertEqual(account.account_status, "pending")
                fetch.assert_called_once_with(APPLICANT_ID)
                self.push_task.defer.assert_not_called()
                self.assertFalse(
                    CustomerRiskAssessment.objects.filter(user_account=account, assessment_status="complete").exists()
                )

    def test_an_approved_applicant_who_is_no_pep_is_activated_and_assessed_as_sumsub_records_it(self):
        with patch.object(KYCAIDService, "get_applicant_data", return_value=applicant(pep=False)):
            response = self.post_event(verification_completed(applicant=applicant(pep=False)))

        self.assertEqual(response.status_code, 200, response.content)
        _, account = self.refreshed()
        self.assertEqual(account.account_status, "active")
        assessment = CustomerRiskAssessment.objects.get(user_account=account, assessment_status="complete")
        self.assertEqual(assessment.pep_type, "none")
        self.assertEqual(assessment.pep_details, {"pep_type": "none", "details": None})

    def test_an_approval_without_the_applicant_reads_the_pep_flag_from_the_applicant_record(self):
        with patch.object(KYCAIDService, "get_applicant_data", return_value=applicant(pep=True)) as fetch:
            response = self.post_event(verification_completed())

        self.assertEqual(response.status_code, 200, response.content)
        _, account = self.refreshed()
        self.assertEqual((account.account_status, account.rejection_reason), ("rejected", "pep_policy"))
        fetch.assert_called_once_with(APPLICANT_ID)

    def test_an_approval_whose_applicant_record_cannot_be_read_is_refused_for_a_retry(self):
        failure = requests.HTTPError("KYCAID request failed with HTTP 503")
        with patch.object(KYCAIDService, "get_applicant_data", side_effect=failure), self.assertLogs(
            "integrations.kycaid.webhook", level="ERROR"
        ), self.assertLogs("django.request", level="ERROR"):
            response = self.post_event(verification_completed())

        self.assertEqual(response.status_code, 500)
        profile, account = self.refreshed()
        self.assertFalse(profile.is_id_verified)
        self.assertIsNone(profile.review_result)
        self.assertEqual(account.account_status, "pending")
        self.push_task.defer.assert_not_called()

    def test_an_approved_citizen_of_a_fatf_black_list_country_is_still_rejected(self):
        self.profile.citizenship_country = Country.get_or_create_for_code("KP")
        self.profile.save(update_fields=["citizenship_country"])

        with patch.object(KYCAIDService, "get_applicant_data", return_value=applicant(pep=False)):
            response = self.post_event(verification_completed(applicant=applicant(pep=False)))

        self.assertEqual(response.status_code, 200, response.content)
        _, account = self.refreshed()
        self.assertEqual((account.account_status, account.rejection_reason), ("rejected", "fatf_blacklist"))

    def test_an_approval_without_a_current_identity_document_clears_stale_document_evidence(self):
        self.profile.id_document_type, self.profile.id_document_country = "PASSPORT", "GB"
        self.profile.save(update_fields=["id_document_type", "id_document_country"])
        record = applicant(pep=False, documents=[])
        with patch.object(KYCAIDService, "get_applicant_data", return_value=record):
            response = self.post_event(verification_completed(applicant=record))
        self.assertEqual(response.status_code, 200, response.content)
        profile, account = self.refreshed()
        self.assertEqual((profile.id_document_type, profile.id_document_country), (None, None))
        self.assertFalse(profile.used_foreign_passport)
        self.assertEqual(account.account_status, "active")
        assessment = CustomerRiskAssessment.objects.get(user_account=account, assessment_status="complete")
        self.assertEqual(assessment.geographic_risk_score, 1)
        self.assertNotIn("foreign_passport", assessment.assessment_reason)

    def test_an_approval_keeps_the_current_valid_passport_type_without_inventing_its_country(self):
        self.profile.id_document_type, self.profile.id_document_country = "DRIVERS_LICENSE", "GB"
        self.profile.save(update_fields=["id_document_type", "id_document_country"])
        record = applicant(
            pep=False,
            documents=[
                {"type": "PASSPORT", "status": "valid"},
                {"type": "DRIVERS_LICENSE", "status": "invalid"},
            ],
        )
        with patch.object(KYCAIDService, "get_applicant_data", return_value=record):
            response = self.post_event(verification_completed(applicant=record))
        self.assertEqual(response.status_code, 200, response.content)
        profile, account = self.refreshed()
        self.assertEqual((profile.id_document_type, profile.id_document_country), ("PASSPORT", None))
        self.assertFalse(profile.used_foreign_passport)
        self.assertEqual(account.account_status, "active")

    def test_a_pending_kycaid_callback_preserves_previously_recorded_document_evidence(self):
        self.profile.id_document_type, self.profile.id_document_country = "PASSPORT", "GB"
        self.profile.is_id_verified, self.profile.review_result = True, "GREEN"
        self.profile.save(update_fields=["id_document_type", "id_document_country", "is_id_verified", "review_result"])
        self.account.account_status = "active"
        self.account.save(update_fields=["account_status"])
        response = self.post_event(
            verification_completed(status="pending", verified=None, applicant=applicant(pep=False, documents=[]))
        )
        self.assertEqual(response.status_code, 200, response.content)
        profile, account = self.refreshed()
        self.assertEqual((profile.id_document_type, profile.id_document_country), ("PASSPORT", "GB"))
        self.assertTrue(profile.is_id_verified)
        self.assertEqual(account.account_status, "active")
