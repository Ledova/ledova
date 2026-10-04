from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.tests.test_authority_requests import AuthorityRequestCases
from integrations.kyc.base import KYCProvider, VerificationSession
from operators.models import SINGLETON_PK, Operator
from shared.db import atomic, current_alias, use_operator
from users.models import UserProfile

TOKEN_URL = "/api/users/identity-verification/token/"
FORGED_PROFILE_SQL = (
    "INSERT INTO users_userprofile "
    "(uuid, created_at, updated_at, user_id, confirmed_over_18, confirmed_australian_resident, "
    "confirmed_individual_account, is_id_verified, terms_and_conditions, is_signup_completed, kyc_provider) "
    "VALUES (%s, statement_timestamp(), statement_timestamp(), %s, false, false, false, true, false, false, 'kycaid')"
)


class ProtectedIdentityResultsTest(APITransactionTestCase):
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        with use_operator():
            self.user = get_user_model().objects.create_user(
                email="protected-results@example.test", password="pw-12345678", is_active=True, is_email_verified=True
            )
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])

    def test_app_cannot_insert_a_profile_carrying_provider_results_but_can_insert_an_unverified_one(self):
        forged = {
            "is_id_verified": True,
            "verified_at": timezone.now(),
            "review_result": "GREEN",
            "verification_status": "completed",
            "rejection_labels": ["SANCTIONS"],
            "kyc_provider": "sumsub",
            "kycaid_applicant_id": "forged-kycaid-applicant",
            "sumsub_applicant_id": "forged-sumsub-applicant",
            "sumsub_verification_status": "completed",
        }
        for field, value in forged.items():
            with (
                self.subTest(field=field),
                self.app_as(self.user),
                self.assertRaisesMessage(DatabaseError, "Provider identity results"),
                atomic(),
            ):
                UserProfile.objects.create(user=self.user, **{field: value})
        with self.app_as(self.user), self.assertRaisesMessage(DatabaseError, "Provider identity results"), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(FORGED_PROFILE_SQL, [uuid4(), self.user.pk])
        with use_operator():
            self.assertFalse(UserProfile.objects.filter(user=self.user).exists())
        with self.app_as(self.user), atomic():
            profile = UserProfile.objects.create(user=self.user, full_name="protected results")
        with use_operator():
            stored = UserProfile.objects.get(pk=profile.pk)
            self.assertEqual(stored.user_id, self.user.pk)
            self.assertFalse(stored.is_id_verified)
            self.assertEqual(stored.kyc_provider, "kycaid")
            self.assertIsNone(stored.verification_status)
            self.assertIsNone(stored.kycaid_applicant_id)

    def test_app_cannot_delete_the_issuer_identity_policy_row(self):
        with self.app_as(self.user), self.assertRaisesMessage(DatabaseError, "Only platform configuration"), atomic():
            Operator.objects.filter(pk=SINGLETON_PK).delete()
        with self.app_as(self.user), self.assertRaisesMessage(DatabaseError, "Only platform configuration"), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("DELETE FROM operators_operator WHERE id = %s", [SINGLETON_PK])
        with use_operator():
            self.assertTrue(Operator.objects.filter(pk=SINGLETON_PK).exists())
            self.assertTrue(Operator.get().issuer_kyc_required)

    def test_a_stale_applicant_is_reset_and_the_fresh_session_persisted_through_the_operator_connection(self):
        with use_operator():
            profile = UserProfile.objects.create(user=self.user, kycaid_applicant_id="stale-applicant")
        provider = Mock(spec=KYCProvider)
        provider.get_provider_name.return_value = "kycaid"
        provider.create_applicant.return_value = {"applicant_id": "fresh-applicant"}
        provider.generate_session.side_effect = [
            RuntimeError("applicant expired"),
            VerificationSession(
                provider="kycaid", applicant_id="fresh-applicant", form_url="https://example.test/identity"
            ),
        ]
        self.client.force_authenticate(self.user)
        with patch("users.services.identity.get_kyc_provider", return_value=provider):
            response = self.client.post(TOKEN_URL, {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["applicantId"], "fresh-applicant")
        self.assertEqual(
            [call.args[0] for call in provider.generate_session.call_args_list], ["stale-applicant", "fresh-applicant"]
        )
        provider.create_applicant.assert_called_once()
        with use_operator():
            profile.refresh_from_db()
            self.assertEqual(profile.kycaid_applicant_id, "fresh-applicant")
            self.assertEqual(profile.kyc_provider, "kycaid")
            self.assertFalse(profile.is_id_verified)
