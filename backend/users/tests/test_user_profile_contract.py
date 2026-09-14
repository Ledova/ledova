from django.contrib.auth import get_user_model
from djangorestframework_camel_case.util import camelize
from drf_spectacular.generators import SchemaGenerator
from jsonschema import Draft4Validator
from rest_framework.test import APITestCase

from users.models import UserProfile
from users.serializers import UserProfileSerializer

User = get_user_model()


class UserProfileContractTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="contract@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(
            user=self.user, kyc_provider="sumsub", sumsub_verification_status="pending"
        )
        self.client.force_authenticate(self.user)

    def test_list_keeps_the_keys_clients_read_and_drops_the_duplicate_kyc_columns(self):
        body = self.client.get("/api/user-profiles/").json()

        row = body["results"][0]
        self.assertEqual(set(row), set(camelize({name: None for name in UserProfileSerializer.Meta.fields})))
        self.assertTrue(
            {"uuid", "fullName", "email", "isIdVerified", "kycProvider", "verificationStatus", "reviewResult"}
            <= set(row)
        )
        self.assertEqual(row["sumsubVerificationStatus"], "pending")
        for gone in (
            "preScreeningCompletedAt",
            "sumsubReviewResult",
            "sumsubReviewAnswer",
            "sumsubRejectionLabels",
            "sumsubVerifiedAt",
            "kycaidVerificationId",
        ):
            self.assertNotIn(gone, row)

    def test_unknown_query_params_are_ignored_instead_of_erroring(self):
        response = self.client.get("/api/user-profiles/?risk_tolerance=high&verified=true")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_rejection_labels_schema_preserves_nullable_lists_of_strings(self):
        document = SchemaGenerator().get_schema(request=None, public=True)
        schema = document["components"]["schemas"]["UserProfile"]["properties"]["rejectionLabels"]
        self.assertTrue(schema["nullable"])
        self.assertTrue(schema["readOnly"])
        self.profile.rejection_labels = ["DOCUMENT_EXPIRED"]
        self.profile.save(update_fields=["rejection_labels"])
        response = self.client.get("/api/user-profiles/")
        self.assertEqual(response.status_code, 200, response.content)
        labels = response.json()["results"][0]["rejectionLabels"]
        self.assertEqual(labels, ["DOCUMENT_EXPIRED"])
        validator = Draft4Validator(schema)
        self.assertEqual(list(validator.iter_errors(labels)), [])
        for invalid in ("DOCUMENT_EXPIRED", [1], [{"label": "DOCUMENT_EXPIRED"}]):
            with self.subTest(invalid=invalid):
                self.assertFalse(validator.is_valid(invalid))
        for name in ("UserProfileRequest", "PatchedUserProfileRequest"):
            self.assertNotIn("rejectionLabels", document["components"]["schemas"][name]["properties"])
        self.profile.rejection_labels = None
        self.profile.save(update_fields=["rejection_labels"])
        self.assertIsNone(self.client.get("/api/user-profiles/").json()["results"][0]["rejectionLabels"])
