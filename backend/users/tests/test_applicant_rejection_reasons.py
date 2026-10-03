from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from integrations.kyc.base import NormalizedVerificationResult
from shared.models import Country
from users.models import UserAccount, UserProfile
from users.services import identity

User = get_user_model()
NEUTRAL = "UNABLE_TO_VERIFY"
SCREENING_LABELS = (
    "PEP",
    "SANCTIONS",
    "COMPROMISED_PERSONS",
    "ADVERSE_MEDIA",
    "CRIMINAL",
    "BLOCKLIST",
    "RESTRICTED_PERSON",
    "COMPROMISED_PERSON",
)
STORED = ["COMPROMISED_PERSONS", "PEP", "BAD_PROOF_OF_IDENTITY", "SANCTIONS"]
TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(KYC_PROVIDER="sumsub", STORAGES=TEST_STORAGES)
class ApplicantRejectionReasonsTest(APITestCase):
    def setUp(self):
        self.push_task = patch("users.tasks.notifications.send_push_notification").start()
        self.addCleanup(patch.stopall)
        user = User.objects.create_user(email="screened@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(
            user=user,
            kyc_provider="sumsub",
            verification_status="completed",
            review_result="RED",
            rejection_labels=list(STORED),
            citizenship_country=Country.get_or_create_for_code("AU"),
        )
        UserAccount.objects.create(account_number="ACC-SCREENED", user_profile=self.profile)
        self.client.force_authenticate(user)

    def test_the_identity_status_shows_a_neutral_reason_for_a_screening_match(self):
        body = self.client.get("/api/users/identity-verification/status/").json()

        self.assertEqual(body["rejectionLabels"], [NEUTRAL, "BAD_PROOF_OF_IDENTITY"])
        self.assertEqual(body["reviewAnswer"], "RED")

    def test_the_profile_shows_a_neutral_reason_for_a_screening_match(self):
        profile = self.client.get("/api/user-profiles/").json()["results"][0]

        self.assertEqual(profile["rejectionLabels"], [NEUTRAL, "BAD_PROOF_OF_IDENTITY"])

    def test_every_screening_label_either_provider_documents_reads_as_the_neutral_reason(self):
        for label in SCREENING_LABELS:
            with self.subTest(label=label):
                self.profile.rejection_labels = [label, "DOCUMENT_DAMAGED"]
                self.profile.save(update_fields=["rejection_labels"])
                status_body = self.client.get("/api/users/identity-verification/status/").json()
                profile_body = self.client.get("/api/user-profiles/").json()["results"][0]
                self.assertEqual(status_body["rejectionLabels"], [NEUTRAL, "DOCUMENT_DAMAGED"])
                self.assertEqual(profile_body["rejectionLabels"], [NEUTRAL, "DOCUMENT_DAMAGED"])

    def test_the_stored_labels_and_the_staff_view_keep_every_label(self):
        self.client.get("/api/users/identity-verification/status/")
        self.client.get("/api/user-profiles/")
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.rejection_labels, STORED)

        staff = User.objects.create_superuser(email="compliance@example.test", password="pw-12345678")
        self.client.force_login(staff)
        page = self.client.get(reverse("admin:users_userprofile_change", args=[self.profile.pk]))

        self.assertEqual(page.status_code, 200)
        for label in STORED:
            self.assertContains(page, label)

    def test_the_rejection_push_names_no_label(self):
        self.profile.review_result = None
        self.profile.save(update_fields=["review_result"])
        rejected = NormalizedVerificationResult(
            verification_status="completed", review_result="RED", is_verified=False, rejection_labels=list(STORED)
        )

        identity.update_status_from_normalized(self.profile, rejected)

        pushed = self.push_task.defer.call_args.kwargs
        text = " ".join(str(value) for value in pushed.values()).upper()
        for label in SCREENING_LABELS:
            self.assertNotIn(label, text)
