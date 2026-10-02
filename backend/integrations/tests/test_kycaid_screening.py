from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from compliance.models import ComplianceAlert
from integrations.tests.kycaid_payloads import (
    API_TOKEN,
    APPLICANT_ID,
    DOCUMENT_ID,
    VERIFICATION_ID,
    database_screening,
    signed,
)
from shared.models import Country
from users.models import UserAccount, UserProfile

User = get_user_model()
PROFILE_FIELDS = ("verification_status", "review_result", "is_id_verified", "verified_at", "rejection_labels")
ACCOUNT_FIELDS = ("account_status", "rejection_reason", "activation_date")


@override_settings(KYCAID_API_TOKEN=API_TOKEN)
class KYCAIDScreeningMatchTest(APITestCase):
    def setUp(self):
        user = User.objects.create_user(email="screening-match@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(
            user=user,
            kycaid_applicant_id=APPLICANT_ID,
            verification_status="completed",
            review_result="GREEN",
            is_id_verified=True,
            verified_at=timezone.now(),
            citizenship_country=Country.get_or_create_for_code("AU"),
        )
        self.account = UserAccount.objects.create(
            account_number="KYCAID-SCREENED", user_profile=self.profile, account_status="active"
        )

    def post_event(self, payload, signature=None):
        body, valid_signature = signed(payload)
        return self.client.post(
            reverse("kycaid-webhook"),
            body,
            content_type="application/json",
            HTTP_X_DATA_INTEGRITY=valid_signature if signature is None else signature,
        )

    def alerts(self):
        return ComplianceAlert.objects.filter(user_account=self.account)

    def test_a_sanctions_match_raises_a_critical_sanctions_alert_with_the_match_details(self):
        payload = database_screening(
            ["SANCTIONS"],
            ["US_OFAC", "UN_UNSCSL"],
            accuracy=87,
            full_name="Synthetic Applicant",
            dob="1990-01-01",
            residence_country="AU",
        )

        response = self.post_event(payload)

        self.assertEqual(response.status_code, 200, response.content)
        alert = self.alerts().get()
        self.assertEqual(
            (alert.alert_type, alert.severity, alert.triggered_rule, alert.status),
            ("sanctions_match", "critical", "KYC-SCREEN", "new"),
        )
        self.assertIsNone(alert.transaction)
        self.assertIn("SANCTIONS", alert.description)
        details = alert.alert_data
        self.assertEqual(details["provider"], "kycaid")
        self.assertEqual(details["list_types"], ["SANCTIONS"])
        self.assertEqual(details["databases"], ["US_OFAC", "UN_UNSCSL"])
        self.assertEqual(details["accuracy"], 87)
        self.assertEqual(
            (details["applicant_id"], details["verification_id"], details["document_id"]),
            (APPLICANT_ID, VERIFICATION_ID, DOCUMENT_ID),
        )
        self.assertEqual(
            details["matched_person"],
            {"full_name": "Synthetic Applicant", "dob": "1990-01-01", "residence_country": "AU"},
        )

    def test_each_list_type_raises_the_alert_type_and_severity_its_review_needs(self):
        cases = (
            (["PEP"], ["OPEN_SANC_PEPS"], "pep_match", "high"),
            (["WANTED"], ["INTERPOL"], "watchlist_match", "critical"),
            (["EXPIRED"], ["UA_MVS_WANTED_PASSPORT"], "watchlist_match", "high"),
            (["INTERNAL"], ["INTERNAL"], "watchlist_match", "high"),
            (["PEP", "SANCTIONS"], ["OPEN_SANC_DEFAULT"], "sanctions_match", "critical"),
            (["PEP", "WANTED"], ["OPEN_SANC_DEFAULT"], "watchlist_match", "critical"),
        )
        for list_types, databases, alert_type, severity in cases:
            with self.subTest(list_types=list_types):
                self.alerts().delete()
                response = self.post_event(database_screening(list_types, databases))
                self.assertEqual(response.status_code, 200, response.content)
                alert = self.alerts().get()
                self.assertEqual((alert.alert_type, alert.severity), (alert_type, severity))
                self.assertEqual(alert.alert_data["list_types"], list_types)

    def test_the_list_types_can_arrive_under_the_newer_bdb_types_name(self):
        payload = database_screening([], ["OPEN_SANC_PEPS"])
        del payload["list_types"]
        payload["bdb_types"] = ["PEP"]

        self.post_event(payload)

        self.assertEqual(self.alerts().get().alert_type, "pep_match")

    def test_a_match_changes_neither_the_account_nor_the_identity_check(self):
        before = (
            [getattr(self.profile, field) for field in PROFILE_FIELDS],
            [getattr(self.account, field) for field in ACCOUNT_FIELDS],
        )

        self.post_event(database_screening(["SANCTIONS"], ["US_OFAC"]))

        self.profile.refresh_from_db()
        self.account.refresh_from_db()
        after = (
            [getattr(self.profile, field) for field in PROFILE_FIELDS],
            [getattr(self.account, field) for field in ACCOUNT_FIELDS],
        )
        self.assertEqual(after, before)
        self.assertEqual(self.alerts().count(), 1)

    def test_a_repeated_callback_raises_one_alert_and_a_new_match_raises_another(self):
        for _ in range(3):
            self.assertEqual(self.post_event(database_screening(["PEP"], ["OPEN_SANC_PEPS"])).status_code, 200)
        self.assertEqual(self.alerts().count(), 1)

        self.alerts().update(status="closed")
        self.post_event(database_screening(["PEP"], ["OPEN_SANC_PEPS"]))
        self.assertEqual(self.alerts().count(), 1)

        self.post_event(database_screening(["PEP"], ["OPEN_SANC_PEPS", "OCCRP"]))
        self.assertEqual(self.alerts().count(), 2)

    def test_an_unsigned_callback_raises_nothing(self):
        with self.assertLogs("integrations.kycaid.webhook", level="WARNING"):
            response = self.post_event(database_screening(["SANCTIONS"], ["US_OFAC"]), signature="forged")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(ComplianceAlert.objects.exists())

    def test_a_match_for_an_applicant_no_profile_holds_raises_nothing(self):
        payload = database_screening(["SANCTIONS"], ["US_OFAC"], applicant_id="5ca1ab1e0000400080000000000000000999")

        with self.assertLogs("integrations.kycaid.webhook", level="WARNING"):
            response = self.post_event(payload)

        self.assertEqual(response.status_code, 404)
        self.assertFalse(ComplianceAlert.objects.exists())
