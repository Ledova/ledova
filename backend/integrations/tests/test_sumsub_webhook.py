import hashlib
import hmac
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from requests.exceptions import HTTPError
from rest_framework.test import APITestCase

from compliance.constants import DOMESTIC_PEP_RISK_ADJUSTMENT
from compliance.models import CustomerRiskAssessment
from integrations.sumsub.client import SumSubService
from integrations.tests.sumsub_payloads import (
    aml_case,
    hit,
    review,
    step,
    verification_steps,
)
from shared.models import Country
from users.models import UserAccount, UserProfile
from users.services import identity

User = get_user_model()

SECRET = "s3cret"
PUSH_TASK = "users.tasks.notifications.send_push_notification"


@override_settings(SUMSUB_WEBHOOK_SECRET=SECRET)
class SumSubWebhookCase(APITestCase):
    def setUp(self):
        user = User.objects.create_user(email="sumsub@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=user, kyc_provider="sumsub", sumsub_applicant_id="app-1")
        self.account = UserAccount.objects.create(account_number="SUMSUB-ACC", user_profile=self.profile)

    def post_event(self, event_type, applicant_id="app-1", **extra):

        payload = {
            "type": event_type,
            "applicantId": applicant_id,
            "externalUserId": str(self.profile.uuid),
            "correlationId": "req-1",
            "levelName": "basic-kyc-level",
            "createdAtMs": timezone.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            **extra,
        }
        body = json.dumps(payload).encode()
        signature = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        return self.client.post(
            reverse("sumsub-webhook"), body, content_type="application/json", HTTP_X_PAYLOAD_DIGEST=signature
        )


class SumSubWebhookTest(SumSubWebhookCase):
    def test_reviewed_event_reads_sumsub_camel_case_keys_and_verifies(self):
        with patch.object(identity, "_trigger_risk_assessment") as risk_assessment, patch(
            "users.tasks.notifications.send_push_notification"
        ) as push_task, patch.object(
            SumSubService, "get_verification_steps", return_value=verification_steps()
        ), patch.object(
            SumSubService, "get_aml_case", return_value=aml_case()
        ):
            response = self.post_event(
                "applicantReviewed", reviewStatus="completed", reviewResult={"reviewAnswer": "GREEN"}
            )

        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.account.refresh_from_db()
        self.assertTrue(self.profile.is_id_verified)
        self.assertIsNotNone(self.profile.verified_at)
        self.assertEqual(self.profile.verification_status, "completed")
        self.assertEqual(self.profile.review_result, "GREEN")
        self.assertEqual(self.profile.sumsub_verification_status, "completed")
        self.assertEqual(self.account.account_status, "active")
        risk_assessment.assert_called_once()
        self.assertEqual(risk_assessment.call_args.args[0], self.account)
        self.assertEqual(push_task.defer.call_args.kwargs["title"], "Identity verified")

    def test_pending_event_updates_the_status_clients_display(self):
        response = self.post_event("applicantPending", reviewStatus="pending")

        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.sumsub_verification_status, "pending")
        self.assertFalse(self.profile.is_id_verified)

    def test_created_and_on_hold_events_track_status(self):
        self.assertEqual(self.post_event("applicantCreated").status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.sumsub_verification_status, "init")

        self.assertEqual(self.post_event("applicantOnHold").status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.sumsub_verification_status, "onHold")

    def test_new_applicant_id_is_stored_from_the_camel_case_key(self):
        response = self.post_event("applicantPending", applicant_id="app-2")

        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.sumsub_applicant_id, "app-2")

    def test_snake_case_ids_are_not_accepted(self):
        payload = {"type": "applicantPending", "applicant_id": "app-1", "external_user_id": str(self.profile.uuid)}
        body = json.dumps(payload).encode()
        signature = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()

        response = self.client.post(
            reverse("sumsub-webhook"), body, content_type="application/json", HTTP_X_PAYLOAD_DIGEST=signature
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "Missing externalUserId"})

    def test_bad_signature_is_rejected(self):
        response = self.client.post(
            reverse("sumsub-webhook"), b"{}", content_type="application/json", HTTP_X_PAYLOAD_DIGEST="nope"
        )

        self.assertEqual(response.status_code, 400)

    def test_status_events_record_the_status_the_apps_read(self):
        for event, status in (
            ("applicantCreated", "init"),
            ("applicantPending", "pending"),
            ("applicantOnHold", "onHold"),
        ):
            with self.subTest(event=event):
                self.assertEqual(self.post_event(event).status_code, 200)
                self.profile.refresh_from_db()
                self.assertEqual(
                    (self.profile.verification_status, self.profile.sumsub_verification_status), (status, status)
                )

    def test_a_status_event_for_a_profile_now_on_kycaid_leaves_the_status_the_apps_read(self):
        self.profile.kyc_provider = "kycaid"
        self.profile.verification_status = "pending"
        self.profile.save(update_fields=["kyc_provider", "verification_status"])

        self.assertEqual(self.post_event("applicantOnHold").status_code, 200)

        self.profile.refresh_from_db()
        self.assertEqual(
            (self.profile.verification_status, self.profile.sumsub_verification_status), ("pending", "onHold")
        )


class SumSubApprovalWebhookTest(SumSubWebhookCase):
    def setUp(self):
        super().setUp()
        self.profile.citizenship_country = Country.get_or_create_for_code("AU")
        self.profile.verification_status = "pending"
        self.profile.save(update_fields=["citizenship_country", "verification_status"])
        push = patch(PUSH_TASK)
        self.push_task = push.start()
        self.addCleanup(push.stop)

    def approve(self, case=None, steps=None, case_error=None, steps_error=None):
        with patch.object(
            SumSubService,
            "get_verification_steps",
            return_value=verification_steps() if steps is None else steps,
            side_effect=steps_error,
        ) as self.read_steps, patch.object(
            SumSubService, "get_aml_case", return_value=aml_case() if case is None else case, side_effect=case_error
        ) as self.read_case:
            response = self.post_event("applicantReviewed", **review())
        self.profile.refresh_from_db()
        self.account.refresh_from_db()
        return response

    def assessment(self):
        return CustomerRiskAssessment.objects.get(user_account=self.account, assessment_status="complete")

    def assert_held(self):
        self.assertFalse(self.profile.is_id_verified)
        self.assertEqual((self.profile.verification_status, self.profile.review_result), ("pending", None))
        self.assertEqual(self.account.account_status, "pending")
        self.assertFalse(CustomerRiskAssessment.objects.filter(user_account=self.account).exists())
        self.push_task.defer.assert_not_called()

    def test_an_approval_reads_the_reviewed_applicants_verification_steps_and_aml_case(self):
        response = self.approve()

        self.assertEqual(response.status_code, 200, response.content)
        self.read_steps.assert_called_once_with("app-1")
        self.read_case.assert_called_once_with("app-1")
        self.assertEqual(self.assessment().pep_details, {"pep_type": "none", "details": None})

    def test_an_approved_pep_is_activated_with_the_pep_risk_weighting_and_not_rejected(self):
        response = self.approve(aml_case(hit("hit-1", "true_positive", "pep")))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.profile.is_id_verified)
        self.assertEqual((self.account.account_status, self.account.rejection_reason), ("active", ""))
        assessment = self.assessment()
        self.assertEqual(assessment.pep_type, "unknown")
        self.assertEqual(assessment.customer_risk_score, 1 + DOMESTIC_PEP_RISK_ADJUSTMENT)
        self.assertIn("provider_approved_pep", assessment.assessment_reason)
        self.assertEqual(
            assessment.pep_details,
            {
                "pep_type": "unknown",
                "approved_by_provider": True,
                "details": [{"id": "hit-1", "matchStatus": "true_positive", "riskLabels": ["pep"]}],
            },
        )

    def test_an_approval_whose_aml_case_cannot_be_read_is_held_for_sumsub_to_resend(self):
        response = self.approve(case_error=HTTPError("403 synthetic"))

        self.assertEqual(response.status_code, 500)
        self.assert_held()

    def test_an_approval_whose_verification_steps_cannot_be_read_is_held_without_reading_its_aml_case(self):
        response = self.approve(steps_error=HTTPError("503 synthetic"))

        self.assertEqual(response.status_code, 500)
        self.read_case.assert_not_called()
        self.assert_held()

    def test_a_foreign_passport_reaches_the_risk_assessment_of_an_approval(self):
        self.approve(steps=verification_steps(IDENTITY=step("PASSPORT", "GBR")))

        self.assertEqual((self.profile.id_document_type, self.profile.id_document_country), ("PASSPORT", "GB"))
        self.assertTrue(self.profile.used_foreign_passport)
        assessment = self.assessment()
        self.assertEqual(assessment.geographic_risk_score, 2)
        self.assertIn("foreign_passport", assessment.assessment_reason)

    def test_an_australian_passport_is_not_a_foreign_one(self):
        self.approve(steps=verification_steps(IDENTITY=step("PASSPORT", "AUS")))

        self.assertEqual((self.profile.id_document_type, self.profile.id_document_country), ("PASSPORT", "AU"))
        self.assertFalse(self.profile.used_foreign_passport)
        self.assertEqual(self.assessment().geographic_risk_score, 1)

    def test_a_rejection_reads_neither_the_verification_steps_nor_the_aml_case(self):
        with patch.object(SumSubService, "get_verification_steps") as read_steps, patch.object(
            SumSubService, "get_aml_case"
        ) as read_case:
            response = self.post_event("applicantReviewed", **review("RED", rejectLabels=["FORGERY"]))

        self.assertEqual(response.status_code, 200, response.content)
        read_steps.assert_not_called()
        read_case.assert_not_called()
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.review_result, "RED")

    def test_a_missing_issuing_country_clears_a_previous_documents_country_without_inference(self):
        self.profile.id_document_type = "PASSPORT"
        self.profile.id_document_country = "GB"
        self.profile.save(update_fields=["id_document_type", "id_document_country"])
        self.approve(steps=verification_steps(IDENTITY=step("PASSPORT", None)))
        self.assertEqual((self.profile.id_document_type, self.profile.id_document_country), ("PASSPORT", None))
        self.assertFalse(self.profile.used_foreign_passport)

    def test_a_provider_approved_pep_from_a_fatf_blacklist_country_still_is_rejected(self):
        self.profile.citizenship_country = Country.get_or_create_for_code("KP")
        self.profile.save(update_fields=["citizenship_country"])
        self.approve(aml_case(hit("hit-1", "true_positive", "pep")))
        self.assertEqual((self.account.account_status, self.account.rejection_reason), ("rejected", "fatf_blacklist"))
        self.assertFalse(CustomerRiskAssessment.objects.filter(user_account=self.account).exists())

    def test_callback_supplied_aml_evidence_is_replaced_by_the_fetched_case(self):
        with patch.object(SumSubService, "get_verification_steps", return_value=verification_steps()), patch.object(
            SumSubService, "get_aml_case", return_value=aml_case()
        ):
            response = self.post_event(
                "applicantReviewed", **review(), amlCase=aml_case(hit("forged", "true_positive", "pep"))
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.assessment().pep_details, {"pep_type": "none", "details": None})

    def test_a_reviewed_callback_for_a_profile_that_moved_provider_reads_no_evidence_or_changes_its_identity(self):
        self.profile.kyc_provider = "kycaid"
        self.profile.save(update_fields=["kyc_provider"])
        with patch.object(SumSubService, "get_verification_steps") as steps, patch.object(
            SumSubService, "get_aml_case"
        ) as case:
            response = self.post_event("applicantReviewed", **review())
        self.assertEqual(response.status_code, 200, response.content)
        steps.assert_not_called()
        case.assert_not_called()
        self.assert_held()

    def test_an_approval_without_an_approved_identity_step_clears_stale_document_evidence(self):
        self.profile.id_document_type = "PASSPORT"
        self.profile.id_document_country = "GB"
        self.profile.save(update_fields=["id_document_type", "id_document_country"])
        self.approve(steps=verification_steps(IDENTITY=step("PASSPORT", "GBR", answer="RED")))
        self.assertEqual((self.profile.id_document_type, self.profile.id_document_country), (None, None))
        self.assertFalse(self.profile.used_foreign_passport)
        self.assertEqual(self.assessment().geographic_risk_score, 1)

    def test_a_pending_callback_preserves_previously_recorded_document_evidence(self):
        self.profile.id_document_type = "PASSPORT"
        self.profile.id_document_country = "GB"
        self.profile.save(update_fields=["id_document_type", "id_document_country"])
        response = self.post_event("applicantPending")
        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.assertEqual((self.profile.id_document_type, self.profile.id_document_country), ("PASSPORT", "GB"))
