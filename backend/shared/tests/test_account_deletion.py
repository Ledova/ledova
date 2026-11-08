from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth.tokens import default_token_generator
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient, APITransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from authentication.managers.user import EmailLookupState
from authentication.services.email_codes import EmailCodeService
from authentication.services.sessions import SessionService
from authentication.services.tokens import TokenService
from companies.models import Company
from shared.db import use_operator
from shared.models import Country
from shared.tests.core_fixtures import PASSWORD, CoreFixtures, person
from tokens.models import (
    MemberAssociation,
    MemberInvitation,
    RegisterEntry,
    RegisterExport,
    RegisterGrantDecision,
    RegisterMemberParticulars,
    RegisterParticularsChange,
    RegisterPosition,
)
from users.models import DeviceToken, FinancialProfile, Notification, UserPreferences
from users.services.identity import populate_profile
from users.services.notifications import NotificationService


class AccountDeletionTest(CoreFixtures, APITransactionTestCase):
    def test_account_erasure_preserves_company_records_and_refuses_stale_writers(self):
        subject, profile = person("deletion-member")
        with use_operator():
            country = Country.get_or_create_for_code("AU")
            profile.full_name = "Synthetic Member"
            profile.residential_address = "1 Example Street, Sydney NSW 2000"
            profile.date_of_birth = date(1990, 1, 1)
            profile.phone_country_code = "+61"
            profile.phone_number = "400000001"
            profile.citizenship_country = country
            profile.residence_country = country
            profile.confirmed_over_18 = True
            profile.confirmed_australian_resident = True
            profile.confirmed_individual_account = True
            profile.kycaid_applicant_id = "synthetic-retained-verification"
            profile.save()
            subject.email_verification_token = "synthetic-unused-verification-code"
            subject.email_verification_sent_at = timezone.now()
            subject.email_verification_attempts = 2
            subject.save()
            financial = FinancialProfile.objects.create(user_profile=profile, occupation="Synthetic engineer")
            FinancialProfile.objects.create(user_profile=self.foreign_profile, occupation="Unrelated account")
            DeviceToken.objects.create(user=subject, push_token="ExponentPushToken[deletion]", device_type="ios")
            foreign_device = DeviceToken.objects.create(
                user=self.foreign, push_token="ExponentPushToken[untouched]", device_type="ios"
            )
            Notification.objects.create(user=subject, title="Private account notice", body="Synthetic inbox data")
            foreign_notice = Notification.objects.create(user=self.foreign, title="Unrelated", body="Keep")
            access, refresh = TokenService.issue(subject)
            foreign_access, _ = TokenService.issue(self.foreign)
            reset = {
                "uid": urlsafe_base64_encode(force_bytes(subject.pk)),
                "token": default_token_generator.make_token(subject),
            }

        grant = self.prepare_grant(
            member=str(self.member.pk),
            new_member=False,
            name=profile.full_name,
            residential_address=profile.residential_address,
        )
        self.decision("/api/v1/tokens/register-grants/", grant, "approve")
        recorded, _ = self.decision("/api/v1/tokens/register-grants/", grant, "apply")
        entry = recorded.json()["registerEntry"]
        with use_operator():
            sequence = RegisterEntry.objects.get(pk=entry).sequence
        certificate_path = f"/api/v1/tokens/{self.token.pk}/register/certificate/"
        preview = self.client.get(certificate_path, {"sequence": sequence})
        self.assertEqual(preview.status_code, 200, preview.content)
        certificate = self.client.post(
            certificate_path,
            {
                "sequence": sequence,
                "appointment": str(self.appointment.pk),
                "source_digest": preview.json()["sourceDigest"],
            },
            format="json",
        )
        self.assertEqual(certificate.status_code, 200, certificate.content)
        invitation = self.client.post(
            "/api/v1/tokens/member-invitations/",
            self.invitation_payload(intended_email=subject.email),
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        member_client = APIClient()
        member_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        accepted = member_client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {"code": invitation.json()["code"], "user_account": str(profile.user_account.pk), "confirmation": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        member_path = f"/api/v1/tokens/member-records/{accepted.json()['uuid']}/"
        self.assertEqual(member_client.get(member_path).status_code, 200)
        retained_models = (
            Company,
            MemberInvitation,
            MemberAssociation,
            RegisterMemberParticulars,
            RegisterPosition,
            RegisterEntry,
            RegisterParticularsChange,
            RegisterGrantDecision,
            RegisterExport,
        )
        with use_operator():
            before = {model: list(model.objects.order_by("pk").values()) for model in retained_models}
            foreign_financial = list(FinancialProfile.objects.filter(user_profile=self.foreign_profile).values())
            foreign_preferences = list(UserPreferences.objects.filter(user_profile=self.foreign_profile).values())
        files = {path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}

        closed = member_client.post("/api/user-profiles/delete-account/", {}, format="json")
        self.assertEqual(closed.status_code, 200, closed.content)
        self.assertEqual(member_client.get("/api/auth/verify/").json(), {"valid": False})
        self.assertEqual(member_client.get(member_path).status_code, 401)
        self.assertEqual(
            member_client.post("/api/token/refresh/", {"refresh": refresh}, format="json").status_code, 401
        )
        self.assertEqual(
            APIClient()
            .post("/api/password-reset/confirm/", {**reset, "newPassword": PASSWORD}, format="json")
            .status_code,
            400,
        )

        stale = APIClient()
        stale.force_authenticate(subject)
        for path, fields in (
            ("/api/financial-profiles/", {"occupation": "Recreated"}),
            ("/api/device-tokens/register/", {"push_token": "ExponentPushToken[recreated]", "device_type": "ios"}),
            ("/api/user-preferences/", {"transaction_alerts": True}),
        ):
            with self.subTest(path=path):
                refused = stale.post(path, fields, format="json")
                self.assertEqual(refused.status_code, 404, refused.content)
        for path, fields in (
            (f"/api/financial-profiles/{financial.pk}/", {"occupation": "Restored"}),
            (f"/api/user-profiles/{profile.pk}/", {"full_name": "Restored"}),
        ):
            with self.subTest(path=path):
                refused = stale.patch(path, fields, format="json")
                self.assertEqual(refused.status_code, 404, refused.content)

        with use_operator():
            with patch("authentication.services.email_codes.sendgrid_client.send_email") as delivery:
                self.assertFalse(EmailCodeService.send(subject))
                delivery.assert_not_called()
            subject.userprofile.is_signup_completed = False
            with (
                patch(
                    "authentication.services.sessions.resolve_signup_email",
                    return_value=(subject.email, SimpleNamespace(state=EmailLookupState.UNIQUE, user=subject)),
                ),
                self.assertRaises(ValidationError),
            ):
                SessionService.signup(subject.email, PASSWORD, PASSWORD)
            profile.refresh_from_db()
            self.assertFalse(
                populate_profile(
                    profile,
                    {
                        "fullName": "Restored",
                        "address": "Restored address",
                        "dateOfBirth": "1990-01-01",
                        "residenceCountry": "AU",
                    },
                )
            )
            skipped = NotificationService().notify_user(subject, "Late notice", "Must not recreate inbox data")
            self.assertEqual(skipped["status"], "skipped")
            subject.refresh_from_db()
            profile.refresh_from_db()
            self.assertFalse(subject.is_active)
            self.assertFalse(subject.is_email_verified)
            self.assertFalse(subject.has_usable_password())
            self.assertTrue(subject.email.endswith("@deleted.invalid"))
            self.assertIsNone(subject.email_verification_token)
            self.assertIsNone(subject.email_verification_sent_at)
            self.assertEqual(subject.email_verification_attempts, 0)
            self.assertFalse(default_token_generator.check_token(subject, reset["token"]))
            self.assertFalse(TokenService.is_session_live(AccessToken(access)["rjti"]))
            self.assertTrue(TokenService.is_session_live(AccessToken(foreign_access)["rjti"]))
            self.assertEqual(profile.full_name, "Deleted User")
            for field in (
                "phone_country_code",
                "phone_number",
                "residential_address",
                "date_of_birth",
                "citizenship_country",
                "residence_country",
            ):
                self.assertIsNone(getattr(profile, field), field)
            self.assertFalse(profile.confirmed_over_18)
            self.assertFalse(profile.confirmed_australian_resident)
            self.assertFalse(profile.confirmed_individual_account)
            self.assertTrue(profile.is_id_verified)
            self.assertEqual(profile.kycaid_applicant_id, "synthetic-retained-verification")
            self.assertFalse(FinancialProfile.objects.filter(user_profile=profile).exists())
            self.assertFalse(UserPreferences.objects.filter(user_profile=profile).exists())
            self.assertFalse(DeviceToken.objects.filter(user=subject).exists())
            self.assertFalse(Notification.objects.filter(user=subject).exists())
            self.assertTrue(DeviceToken.objects.filter(pk=foreign_device.pk).exists())
            self.assertTrue(Notification.objects.filter(pk=foreign_notice.pk).exists())
            self.assertEqual(
                list(FinancialProfile.objects.filter(user_profile=self.foreign_profile).values()), foreign_financial
            )
            self.assertEqual(
                list(UserPreferences.objects.filter(user_profile=self.foreign_profile).values()), foreign_preferences
            )
            for model, rows in before.items():
                self.assertEqual(list(model.objects.order_by("pk").values()), rows, model.__name__)
        self.assertEqual({path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}, files)
