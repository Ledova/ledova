from datetime import date, timedelta
from io import StringIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken

from authentication.managers.user import EmailLookupState
from authentication.services.email_codes import EmailCodeService
from authentication.services.sessions import SessionService
from authentication.services.tokens import TokenService
from companies.models import Company
from compliance.constants import IDENTITY_SCREENING_RULE
from compliance.models import ComplianceAlert, CustomerRiskAssessment
from compliance.services.identity_screening import raise_screening_alert
from compliance.services.risk_assessment import RiskAssessmentService
from compliance.tasks import check_periodic_reviews
from integrations.kyc.base import NormalizedVerificationResult
from shared.db import reset_principal, use_operator
from shared.models import Country
from shared.tasks.job_retention import remove_old_jobs
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
from users.models import (
    AccountErasureWorkItem,
    DeviceToken,
    FinancialProfile,
    Notification,
    UserPreferences,
    UserProfile,
)
from users.services import identity
from users.services.erasure import complete_provider_erasure
from users.services.identity import populate_profile
from users.services.lifecycle import delete_account
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
            profile.sumsub_applicant_id = "synthetic-sumsub-verification"
            profile.id_document_type = "PASSPORT"
            profile.rejection_labels = ["Private provider result"]
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
            CustomerRiskAssessment.objects.filter(user_account=profile.user_account).update(
                pep_details={"name": "Erase"}
            )
            ComplianceAlert.objects.create(
                user_account=profile.user_account,
                alert_type="pep_match",
                severity="high",
                triggered_rule=IDENTITY_SCREENING_RULE,
                description="Erase this account-only screening result",
                alert_data={"document_id": "private-document"},
            )
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
            {
                "code": invitation.json()["code"],
                "user_account": str(profile.user_account.pk),
                "confirmation": True,
            },
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
            (
                "/api/device-tokens/register/",
                {"push_token": "ExponentPushToken[recreated]", "device_type": "ios"},
            ),
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
                    return_value=(
                        subject.email,
                        SimpleNamespace(state=EmailLookupState.UNIQUE, user=subject),
                    ),
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
            self.assertFalse(profile.is_id_verified)
            self.assertIsNone(profile.kycaid_applicant_id)
            self.assertIsNone(profile.sumsub_applicant_id)
            self.assertIsNone(profile.id_document_type)
            self.assertIsNone(profile.rejection_labels)
            self.assertFalse(CustomerRiskAssessment.objects.filter(user_account=profile.user_account).exists())
            self.assertFalse(ComplianceAlert.objects.filter(user_account=profile.user_account).exists())
            self.assertEqual(AccountErasureWorkItem.objects.filter(user=subject, completed_at__isnull=True).count(), 2)
            with patch("users.services.identity.get_kyc_provider") as provider:
                for operation in (identity.get_verification_session, identity.get_verification_status):
                    with self.assertRaises(NotFound):
                        operation(profile)
                provider.assert_not_called()
            self.assertFalse(
                identity.update_status_from_normalized(
                    profile, NormalizedVerificationResult("completed", "GREEN", True)
                )
            )
            self.assertIsNone(RiskAssessmentService.calculate_and_create(profile.user_account, {"name": "Restored"}))
            self.assertIsNone(
                raise_screening_alert(profile.user_account, {"provider": "kycaid", "applicant_id": "Restored"})
            )
            self.assertFalse(FinancialProfile.objects.filter(user_profile=profile).exists())
            self.assertFalse(UserPreferences.objects.filter(user_profile=profile).exists())
            self.assertFalse(DeviceToken.objects.filter(user=subject).exists())
            self.assertFalse(Notification.objects.filter(user=subject).exists())
            self.assertTrue(DeviceToken.objects.filter(pk=foreign_device.pk).exists())
            self.assertTrue(Notification.objects.filter(pk=foreign_notice.pk).exists())
            self.assertEqual(
                list(FinancialProfile.objects.filter(user_profile=self.foreign_profile).values()),
                foreign_financial,
            )
            self.assertEqual(
                list(UserPreferences.objects.filter(user_profile=self.foreign_profile).values()),
                foreign_preferences,
            )
            for model, rows in before.items():
                self.assertEqual(list(model.objects.order_by("pk").values()), rows, model.__name__)
        self.assertEqual({path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}, files)
        with patch("integrations.sumsub.webhook.SumSubService.verify_webhook_signature", return_value=True):
            response = APIClient().post(
                "/webhooks/sumsub/",
                {"type": "applicantPending", "applicantId": "Restored", "externalUserId": str(profile.pk)},
                format="json",
            )
            self.assertEqual(response.status_code, 200, response.content)
        with patch("integrations.kycaid.webhook.KYCAIDService.verify_webhook_signature", return_value=True):
            response = APIClient().post(
                "/webhooks/kycaid/",
                {"type": "database_screening", "applicant_id": "synthetic-retained-verification"},
                format="json",
            )
            self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            profile.refresh_from_db()
            self.assertIsNone(profile.sumsub_applicant_id)
            self.assertFalse(profile.is_id_verified)
            self.assertFalse(CustomerRiskAssessment.objects.filter(user_account=profile.user_account).exists())
            self.assertFalse(ComplianceAlert.objects.filter(user_account=profile.user_account).exists())

    def test_provider_follow_up_and_maintenance_preserve_holds_and_used_accounts(self):
        subject, profile = person("held-erasure")
        abandoned, abandoned_profile = person("abandoned-signup")
        original_email = subject.email
        old = timezone.now() - timedelta(days=31)
        with use_operator():
            reset_principal()
            profile.kycaid_applicant_id = "provider-held-applicant"
            profile.save(update_fields=["kycaid_applicant_id"])
            held = ComplianceAlert.objects.create(
                user_account=profile.user_account,
                alert_type="manual",
                severity="high",
                triggered_rule="case",
                description="Retain this specific case",
                smr_required=True,
            )
            CustomerRiskAssessment.objects.filter(user_account=profile.user_account).update(
                assessment_status="complete", next_review_date=old
            )
            for user, candidate in ((abandoned, abandoned_profile), (self.owner, self.profile)):
                get_user_model().objects.filter(pk=user.pk).update(date_joined=old, last_login=old)
                UserProfile.objects.filter(pk=candidate.pk).update(is_signup_completed=False, updated_at=old)
            expired = OutstandingToken.objects.create(
                user=subject, jti="expired-erasure-session", token="expired", expires_at=old
            )
            Session.objects.create(session_key="expired-erasure-session", session_data="expired", expire_date=old)
            get_user_model().objects.filter(pk=self.foreign.pk).update(
                email_verification_token="expired-code",
                email_verification_sent_at=old,
                email_verification_attempts=2,
            )
            get_user_model().objects.filter(pk=self.owner.pk).update(
                email_verification_token="fresh-code", email_verification_sent_at=timezone.now()
            )
            delete_account(subject, automated=True)
            item = AccountErasureWorkItem.objects.get(user=subject)
            self.assertIn(str(held.pk), item.hold_reason)
            self.assertIsNotNone(item.review_due_at)
            self.assertTrue(CustomerRiskAssessment.objects.filter(user_account=profile.user_account).exists())
            self.assertTrue(ComplianceAlert.objects.filter(pk=held.pk).exists())
            self.assertEqual(check_periodic_reviews(timestamp=0), "Flagged 0 assessments for periodic review")
            with self.assertRaises(CommandError):
                call_command(
                    "provider_erasure",
                    "complete",
                    work_item=item.pk,
                    reference="provider-receipt",
                    stdout=StringIO(),
                )
            with patch(
                "users.services.erasure.sendgrid_client.send_email", return_value={"success": False}
            ) as delivery:
                with self.assertRaises(ValueError):
                    complete_provider_erasure(item.pk, "provider-receipt")
                delivery.assert_not_called()
                with self.assertRaises(ValueError):
                    complete_provider_erasure(item.pk, "provider-receipt", "case-release")
            item.refresh_from_db()
            self.assertIsNone(item.completed_at)
            self.assertEqual(item.completion_email, original_email)
            with patch("users.services.erasure.sendgrid_client.send_email", return_value={"success": True}) as delivery:
                call_command(
                    "provider_erasure",
                    "complete",
                    work_item=item.pk,
                    reference="provider-receipt",
                    confirm_permanent_deletion=True,
                    release_hold_reference="case-release",
                    stdout=StringIO(),
                )
                self.assertEqual(delivery.call_args.kwargs["to_email"], original_email)
            item.refresh_from_db()
            self.assertIsNotNone(item.completed_at)
            self.assertEqual(item.applicant_id, "")
            self.assertEqual(item.completion_email, "")
            with patch("shared.tasks.job_retention.app.job_manager.delete_old_jobs", new=AsyncMock()):
                self.assertEqual(remove_old_jobs()["abandoned_signups"], 1)
            self.assertFalse(OutstandingToken.objects.filter(pk=expired.pk).exists())
            self.assertFalse(Session.objects.filter(session_key="expired-erasure-session").exists())
            abandoned.refresh_from_db()
            self.owner.refresh_from_db()
            self.foreign.refresh_from_db()
            self.assertFalse(abandoned.is_active)
            self.assertTrue(abandoned.email.endswith("@deleted.invalid"))
            self.assertTrue(self.owner.is_active)
            self.assertEqual(self.owner.email_verification_token, "fresh-code")
            self.assertIsNone(self.foreign.email_verification_token)
            self.assertTrue(Company.objects.filter(pk=self.company.pk, owner=self.owner).exists())
