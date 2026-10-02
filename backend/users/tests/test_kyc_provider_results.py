from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from requests.exceptions import HTTPError
from rest_framework.test import APITestCase

from compliance.constants import DOMESTIC_PEP_RISK_ADJUSTMENT
from compliance.models import CustomerRiskAssessment
from integrations.kyc.base import NormalizedVerificationResult
from integrations.kyc.pep import pep_data_from_labels
from integrations.kycaid.client import KYCAIDService
from integrations.sumsub.client import SumSubService
from integrations.tests.kycaid_payloads import (
    APPLICANT_ID,
    applicant,
    verification_completed,
)
from integrations.tests.sumsub_payloads import (
    aml_case,
    hit,
    review,
    step,
    verification_steps,
)
from shared.models import Country
from users.models import UserAccount, UserProfile
from users.services.identity import IdentityVerificationService

User = get_user_model()
PUSH_TASK = "users.tasks.notifications.send_push_notification"
STATUS_URL = "/api/users/identity-verification/status/"


def a_person(email, **profile_fields):
    user = User.objects.create_user(email=email, password="pw-12345678")
    profile = UserProfile.objects.create(
        user=user, citizenship_country=Country.get_or_create_for_code("AU"), **profile_fields
    )
    account = UserAccount.objects.create(account_number=f"ACC-{user.pk:06d}", user_profile=profile)
    return profile, account


def sumsub_approval(case=None):
    service = SumSubService()
    with patch.object(SumSubService, "get_verification_steps", return_value=verification_steps()), patch.object(
        SumSubService, "get_aml_case", return_value=aml_case() if case is None else case
    ):
        return service.normalize_webhook(service.with_approval_evidence("synthetic-applicant", review()))


def an_approval_of_a_pep(*evidence):
    return NormalizedVerificationResult(
        verification_status="completed",
        review_result="GREEN",
        is_verified=True,
        pep_data=pep_data_from_labels(list(evidence)),
    )


@override_settings(KYC_PROVIDER="kycaid")
class KYCAIDStatusPollTest(APITestCase):
    def setUp(self):
        self.push_task = patch(PUSH_TASK).start()
        self.addCleanup(patch.stopall)
        self.profile, self.account = a_person(
            "kycaid-poll@example.test", kycaid_applicant_id=APPLICANT_ID, verification_status="pending"
        )
        self.client.force_authenticate(self.profile.user)

    def poll(self, record):
        with patch.object(KYCAIDService, "get_applicant_status", return_value=record), patch.object(
            KYCAIDService, "get_applicant_data", return_value=record
        ):
            response = self.client.get(STATUS_URL)
        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.account.refresh_from_db()
        return response.json()

    def test_a_valid_last_verification_verifies_and_activates_as_a_sumsub_poll_does(self):
        body = self.poll(applicant(verification_status="valid"))

        self.assertTrue(body["isVerified"])
        self.assertEqual((body["status"], body["reviewResult"]), ("completed", "GREEN"))
        self.assertEqual(self.account.account_status, "active")

    def test_a_valid_last_verification_of_a_pep_is_rejected_by_the_unchanged_policy(self):
        self.poll(applicant(verification_status="valid", pep=True))

        self.assertTrue(self.profile.is_id_verified)
        self.assertEqual((self.account.account_status, self.account.rejection_reason), ("rejected", "pep_policy"))

    def test_an_invalid_last_verification_records_the_rejection_and_its_reasons(self):
        body = self.poll(applicant(verification_status="invalid", decline_reasons=["WRONG_NAME"]))

        self.assertEqual((body["status"], body["reviewResult"]), ("completed", "RED"))
        self.assertEqual(body["rejectionLabels"], ["WRONG_NAME"])
        self.assertFalse(self.profile.is_id_verified)

    def test_a_pending_last_verification_changes_nothing(self):
        body = self.poll(applicant(verification_status="pending"))

        self.assertEqual((body["status"], body["reviewResult"]), ("pending", None))
        self.assertEqual(self.account.account_status, "pending")
        self.push_task.defer.assert_not_called()

    def test_a_record_carrying_a_status_key_is_still_read_as_an_applicant_record(self):
        record = {**applicant(verification_status="invalid"), "status": "completed", "verified": True}

        body = self.poll(record)

        self.assertFalse(body["isVerified"])
        self.assertEqual((body["status"], body["reviewResult"]), ("completed", "RED"))
        self.assertEqual(self.account.account_status, "pending")

    def test_an_approved_record_without_the_pep_flag_is_not_applied(self):
        record = {key: value for key, value in applicant(verification_status="valid").items() if key != "pep"}

        with self.assertLogs("integrations.kycaid.client", level="WARNING"):
            body = self.poll(record)

        self.assertFalse(body["isVerified"])
        self.assertEqual((self.profile.verification_status, self.profile.review_result), ("pending", None))
        self.assertEqual(self.account.account_status, "pending")
        self.push_task.defer.assert_not_called()


@override_settings(KYC_PROVIDER="sumsub")
class SumsubStatusPollTest(APITestCase):
    def setUp(self):
        self.push_task = patch(PUSH_TASK).start()
        self.addCleanup(patch.stopall)
        self.profile, self.account = a_person(
            "sumsub-poll@example.test",
            kyc_provider="sumsub",
            sumsub_applicant_id="synthetic-applicant",
            verification_status="pending",
        )
        self.client.force_authenticate(self.profile.user)

    def poll(self, status, case=None, steps=None, case_error=None):
        with patch.object(SumSubService, "get_applicant_status", return_value=status), patch.object(
            SumSubService, "get_verification_steps", return_value=verification_steps() if steps is None else steps
        ), patch.object(
            SumSubService, "get_aml_case", return_value=aml_case() if case is None else case, side_effect=case_error
        ), patch.object(
            SumSubService, "get_applicant_data", return_value={"info": {}}
        ):
            response = self.client.get(STATUS_URL)
        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.account.refresh_from_db()
        return response.json()

    def test_a_provisional_approval_while_sumsub_awaits_a_service_is_not_applied(self):
        body = self.poll({"reviewStatus": "awaitingService", "reviewResult": {"reviewAnswer": "GREEN"}})

        self.assertFalse(body["isVerified"])
        self.assertEqual((self.profile.verification_status, self.profile.review_result), ("pending", None))
        self.assertEqual(self.account.account_status, "pending")
        self.push_task.defer.assert_not_called()

    def test_a_completed_approval_is_applied(self):
        body = self.poll({"reviewStatus": "completed", "reviewResult": {"reviewAnswer": "GREEN"}})

        self.assertTrue(body["isVerified"])
        self.assertEqual(self.account.account_status, "active")

    def test_an_approval_whose_aml_case_cannot_be_read_is_not_applied(self):
        body = self.poll(review(), case_error=HTTPError("429 synthetic"))

        self.assertFalse(body["isVerified"])
        self.assertEqual((self.profile.verification_status, self.profile.review_result), ("pending", None))
        self.assertEqual(self.account.account_status, "pending")
        self.assertFalse(CustomerRiskAssessment.objects.filter(user_account=self.account).exists())
        self.push_task.defer.assert_not_called()

    def test_an_approved_pep_is_activated_with_the_pep_risk_weighting(self):
        body = self.poll(review(), case=aml_case(hit("hit-1", "potential_match", "pep")))

        self.assertTrue(body["isVerified"])
        self.assertEqual((self.account.account_status, self.account.rejection_reason), ("active", ""))
        assessment = CustomerRiskAssessment.objects.get(user_account=self.account, assessment_status="complete")
        self.assertEqual(assessment.pep_type, "unknown")
        self.assertEqual(assessment.customer_risk_score, 1 + DOMESTIC_PEP_RISK_ADJUSTMENT)

    def test_a_foreign_passport_reaches_the_risk_assessment(self):
        self.poll(review(), steps=verification_steps(IDENTITY=step("PASSPORT", "NZL")))

        self.assertEqual((self.profile.id_document_type, self.profile.id_document_country), ("PASSPORT", "NZ"))
        assessment = CustomerRiskAssessment.objects.get(user_account=self.account, assessment_status="complete")
        self.assertIn("foreign_passport", assessment.assessment_reason)


class PoliticallyExposedPersonPolicyTest(TestCase):
    def setUp(self):
        patch(PUSH_TASK).start()
        self.addCleanup(patch.stopall)

    def approve(self, email, normalized, **profile_fields):
        profile, account = a_person(email, **profile_fields)
        IdentityVerificationService.update_status_from_normalized(profile, normalized)
        account.refresh_from_db()
        return account

    def test_a_domestic_pep_is_accepted_with_the_policy_adjustment(self):
        account = self.approve("domestic-pep@example.test", an_approval_of_a_pep("domestic_pep"))

        self.assertEqual(account.account_status, "active")
        assessment = CustomerRiskAssessment.objects.get(user_account=account, assessment_status="complete")
        self.assertEqual(assessment.pep_type, "domestic")
        self.assertEqual(assessment.customer_risk_score, 1 + DOMESTIC_PEP_RISK_ADJUSTMENT)
        self.assertEqual(assessment.pep_details, {"pep_type": "domestic", "details": ["domestic_pep"]})

    def test_a_pep_a_sumsub_approval_clears_is_accepted_with_the_policy_adjustment(self):
        account = self.approve(
            "sumsub-cleared-pep@example.test",
            sumsub_approval(aml_case(hit("hit-1", "true_positive", "pep"))),
            kyc_provider="sumsub",
        )

        self.assertEqual((account.account_status, account.rejection_reason), ("active", ""))
        assessment = CustomerRiskAssessment.objects.get(user_account=account, assessment_status="complete")
        self.assertEqual(assessment.pep_type, "unknown")
        self.assertEqual(assessment.customer_risk_score, 1 + DOMESTIC_PEP_RISK_ADJUSTMENT)
        self.assertEqual(
            assessment.pep_details["details"], [{"id": "hit-1", "matchStatus": "true_positive", "riskLabels": ["pep"]}]
        )

    def test_an_unknown_pep_without_a_sumsub_approval_is_rejected(self):
        for provider, clearance in (("sumsub", False), ("kycaid", True)):
            with self.subTest(provider=provider):
                normalized = NormalizedVerificationResult(
                    verification_status="completed",
                    review_result="GREEN",
                    is_verified=True,
                    pep_data={"pep_type": "unknown", "details": [], "approved_by_provider": clearance},
                )
                account = self.approve(f"uncleared-{provider}@example.test", normalized, kyc_provider=provider)
                self.assertEqual((account.account_status, account.rejection_reason), ("rejected", "pep_policy"))

    def test_every_pep_category_the_policy_rejects_is_rejected(self):
        reports = {
            "foreign_pep": an_approval_of_a_pep("foreign_pep"),
            "international_org": an_approval_of_a_pep("international_org_pep"),
            "family": an_approval_of_a_pep("pep_family_member"),
            "associate": an_approval_of_a_pep("close_associate"),
            "uncategorised": an_approval_of_a_pep("PEP"),
            "kycaid-flag": KYCAIDService().normalize_webhook(verification_completed(applicant=applicant(pep=True))),
        }
        for name, normalized in reports.items():
            with self.subTest(report=name):
                account = self.approve(f"{name}@example.test", normalized)
                self.assertEqual((account.account_status, account.rejection_reason), ("rejected", "pep_policy"))
                self.assertFalse(
                    CustomerRiskAssessment.objects.filter(user_account=account, assessment_status="complete").exists()
                )

    def test_kycaid_and_sumsub_record_the_same_person_without_a_pep_identically(self):
        kycaid_account = self.approve(
            "kycaid-clear@example.test",
            KYCAIDService().normalize_webhook(verification_completed(applicant=applicant(pep=False))),
        )
        sumsub_account = self.approve("sumsub-clear@example.test", sumsub_approval(), kyc_provider="sumsub")

        recorded = [
            CustomerRiskAssessment.objects.values("pep_type", "pep_details", "customer_risk_score").get(
                user_account=account, assessment_status="complete"
            )
            for account in (kycaid_account, sumsub_account)
        ]
        self.assertEqual(recorded[0], recorded[1])
        self.assertEqual(recorded[0]["pep_details"], {"pep_type": "none", "details": None})
