from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.test import override_settings
from procrastinate.contrib.django.models import ProcrastinateJob
from redis.exceptions import ConnectionError as RedisConnectionError
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient, APITransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from authentication.services.email_codes import EmailCodeService
from authentication.services.password_reset import (
    INVALID_RESET,
    REQUEST_MESSAGE,
    reset_password,
)
from authentication.services.tokens import TokenService
from authentication.tasks import send_password_reset_email
from shared.db import use_operator
from shared.tests.core_fixtures import PASSWORD, person

REQUEST_PATH = "/api/password-reset/request/"
CONFIRM_PATH = "/api/password-reset/confirm/"
NEW_PASSWORD = " Fresh-Cloud-Lantern-459! "


@override_settings(DASHBOARD_BASE_URL="https://dashboard.example.test", DEBUG=False)
class PasswordResetTest(APITransactionTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)
        self.owner, _ = person("reset-owner")
        self.other, _ = person("reset-other")
        self.sender = self.enterContext(
            patch("authentication.services.password_reset.sendgrid_client.send_email", return_value={"success": True})
        )

    def request_reset(self, email, client=None):
        with patch("authentication.services.password_reset.find_unique_user") as lookup:
            response = (client or self.client).post(REQUEST_PATH, {"email": email}, format="json")
            lookup.assert_not_called()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"message": REQUEST_MESSAGE})
        self.assertEqual(response["Cache-Control"], "no-store")
        with use_operator():
            job = ProcrastinateJob.objects.filter(task_name=send_password_reset_email.name).latest("id")
        self.assertEqual(job.args, {"email": email.strip().lower()})
        return response, job

    def delivered_proof(self, job):
        self.sender.reset_mock()
        send_password_reset_email(**job.args)
        self.sender.assert_called_once()
        text = self.sender.call_args.kwargs["text_content"]
        url = text.splitlines()[0].split(": ", 1)[1]
        parsed = urlsplit(url)
        self.assertEqual(
            (parsed.scheme, parsed.netloc, parsed.path, parsed.query),
            ("https", "dashboard.example.test", "/reset-password", ""),
        )
        return {key: values[0] for key, values in parse_qs(parsed.fragment).items()}

    def test_queued_reset_is_neutral_and_revokes_only_the_target_accounts_sessions(self):
        owner_client = APIClient()
        signed_in = owner_client.post(
            "/api/signin/",
            {"email": self.owner.email, "password": PASSWORD},
            format="json",
            HTTP_X_AUTH_TRANSPORT="bearer",
        )
        self.assertEqual(signed_in.status_code, 200, signed_in.content)
        old = signed_in.json()["tokens"][0]
        admitted_change = APIClient()
        admitted_change.force_authenticate(user=self.owner, token=AccessToken(old["accessToken"]))
        with use_operator():
            other_access, _ = TokenService.issue(self.other)
            with patch.object(EmailCodeService, "generate", return_value="123456"):
                EmailCodeService.send(self.owner)
        self.sender.reset_mock()
        browser = APIClient(enforce_csrf_checks=True)
        browser.cookies[settings.AUTH_COOKIE["access"]] = "unusable-synthetic-cookie"
        expected, job = self.request_reset(" RESET-OWNER@example.test ", browser)
        unknown, missing = self.request_reset("unknown@example.test")
        self.assertEqual(expected.json(), unknown.json())
        send_password_reset_email(**missing.args)
        self.sender.assert_not_called()
        proof = self.delivered_proof(job)

        result = browser.post(CONFIRM_PATH, {**proof, "newPassword": NEW_PASSWORD}, format="json")
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(set(result.json()), {"message"})
        self.assertEqual(result.cookies[settings.AUTH_COOKIE["access"]].value, "")
        self.assertEqual(result.cookies[settings.AUTH_COOKIE["refresh"]].value, "")
        self.assertEqual(result["Cache-Control"], "no-store")
        self.assertEqual(browser.get("/api/auth/verify/").json(), {"valid": False})
        stale_change = admitted_change.post(
            "/api/change-password/",
            {
                "currentPassword": PASSWORD,
                "newPassword": "Rejected-Old-Session-784!",
                "newPasswordConfirm": "Rejected-Old-Session-784!",
            },
            format="json",
        )
        self.assertEqual(stale_change.status_code, 401, stale_change.content)
        replay = browser.post(CONFIRM_PATH, {**proof, "newPassword": NEW_PASSWORD}, format="json")
        self.assertEqual(replay.status_code, 400, replay.content)
        self.assertEqual(replay.json(), {"detail": INVALID_RESET})
        owner_client.credentials(HTTP_AUTHORIZATION=f"Bearer {old['accessToken']}")
        self.assertEqual(owner_client.get("/api/auth/verify/").json(), {"valid": False})
        refreshed = APIClient().post(
            "/api/token/refresh/",
            {"refresh": old["refreshToken"]},
            format="json",
            HTTP_X_AUTH_TRANSPORT="bearer",
        )
        self.assertEqual(refreshed.status_code, 401, refreshed.content)
        previous_email_code = APIClient().post(
            "/api/email-verification/", {"email": self.owner.email, "token": "123456"}, format="json"
        )
        self.assertEqual(previous_email_code.status_code, 400, previous_email_code.content)
        old_password = APIClient().post(
            "/api/signin/", {"email": self.owner.email, "password": PASSWORD}, format="json"
        )
        self.assertEqual(old_password.status_code, 400, old_password.content)
        current_client = APIClient()
        new_password = current_client.post(
            "/api/signin/", {"email": self.owner.email, "password": NEW_PASSWORD}, format="json"
        )
        self.assertEqual(new_password.status_code, 200, new_password.content)
        current_change = {
            "currentPassword": NEW_PASSWORD,
            "newPassword": " Second-Cloud-Lantern-479! ",
            "newPasswordConfirm": " Second-Cloud-Lantern-479! ",
        }
        wrong_current = current_client.post(
            "/api/change-password/", {**current_change, "currentPassword": "wrong-password"}, format="json"
        )
        self.assertEqual(wrong_current.status_code, 400, wrong_current.content)
        self.assertIn("currentPassword", wrong_current.json())
        with use_operator():
            old_successor, _ = TokenService.issue(get_user_model().objects.get(pk=self.owner.pk))
        changed = current_client.post("/api/change-password/", current_change, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(changed.json(), {"message": "Password changed successfully."})
        self.assertTrue(current_client.get("/api/auth/verify/").json()["valid"])
        old_successor_client = APIClient()
        old_successor_client.credentials(HTTP_AUTHORIZATION=f"Bearer {old_successor}")
        self.assertEqual(old_successor_client.get("/api/auth/verify/").json(), {"valid": False})
        other_client = APIClient()
        other_client.credentials(HTTP_AUTHORIZATION=f"Bearer {other_access}")
        self.assertTrue(other_client.get("/api/auth/verify/").json()["valid"])

        _, failed = self.request_reset(self.owner.email)
        self.sender.return_value = {"success": False}
        send_password_reset_email(**failed.args)
        with use_operator():
            unchanged = get_user_model().objects.get(pk=self.owner.pk)
        self.assertTrue(unchanged.check_password(current_change["newPassword"]))
        self.assertTrue(unchanged.is_active)
        self.assertTrue(unchanged.is_email_verified)

    def test_reset_proofs_and_quotas_refuse_without_changing_account_authority(self):
        _, job = self.request_reset(self.owner.email)
        proof = self.delivered_proof(job)
        _, other_job = self.request_reset(self.other.email)
        other_proof = self.delivered_proof(other_job)
        attempts = (
            {**proof, "uid": "invalid"},
            {**proof, "token": "invalid"},
            {**proof, "uid": other_proof["uid"]},
        )
        for attempted in attempts:
            response = self.client.post(CONFIRM_PATH, {**attempted, "newPassword": NEW_PASSWORD}, format="json")
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(response.json(), {"detail": INVALID_RESET})
        weak = self.client.post(CONFIRM_PATH, {**proof, "newPassword": "123"}, format="json")
        self.assertEqual(weak.status_code, 400, weak.content)
        self.assertIn("newPassword", weak.json())
        blank = self.client.post(CONFIRM_PATH, {**proof, "newPassword": " " * 12}, format="json")
        self.assertEqual(blank.status_code, 400, blank.content)
        self.assertIn("newPassword", blank.json())
        with use_operator(), self.assertRaises(ValidationError) as direct_blank:
            reset_password(**proof, new_password=" " * 12)
        self.assertIn("new_password", direct_blank.exception.detail)
        with patch.object(
            default_token_generator,
            "_now",
            return_value=datetime.now() + timedelta(seconds=settings.PASSWORD_RESET_TIMEOUT + 1),
        ):
            expired = self.client.post(CONFIRM_PATH, {**proof, "newPassword": NEW_PASSWORD}, format="json")
        self.assertEqual(expired.status_code, 400, expired.content)
        self.assertEqual(expired.json(), {"detail": INVALID_RESET})

        for field in ("is_active", "is_email_verified"):
            with use_operator():
                get_user_model().objects.filter(pk=self.owner.pk).update(**{field: False})
            response = self.client.post(CONFIRM_PATH, {**proof, "newPassword": NEW_PASSWORD}, format="json")
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(response.json(), {"detail": INVALID_RESET})
            _, ineligible = self.request_reset(self.owner.email)
            self.sender.reset_mock()
            send_password_reset_email(**ineligible.args)
            self.sender.assert_not_called()
            with use_operator():
                get_user_model().objects.filter(pk=self.owner.pk).update(**{field: True})

        for failure, code in (((False, 60), 429), (RedisConnectionError(), 503)):
            quota = SimpleNamespace(take_rate_slot=Mock())
            if isinstance(failure, Exception):
                quota.take_rate_slot.side_effect = failure
            else:
                quota.take_rate_slot.return_value = failure
            with (
                patch("authentication.throttles.PasswordResetIPThrottle.cache", quota),
                patch("authentication.views.user.queue_password_reset") as queued,
            ):
                refused = self.client.post(REQUEST_PATH, {"email": "unknown-quota@example.test"}, format="json")
                self.assertEqual(refused.status_code, code, refused.content)
                queued.assert_not_called()
                quota.take_rate_slot.assert_called_once()
        with use_operator():
            unchanged = get_user_model().objects.get(pk=self.owner.pk)
            other = get_user_model().objects.get(pk=self.other.pk)
        self.assertTrue(unchanged.check_password(PASSWORD))
        self.assertTrue(other.check_password(PASSWORD))
        self.assertTrue(unchanged.is_active)
        self.assertTrue(unchanged.is_email_verified)
