from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from integrations.kyc.base import NormalizedVerificationResult
from shared.models import Country
from users.constants import (
    ACCOUNT_STATUS_ACTIVE,
    ACCOUNT_STATUS_PENDING,
    ACCOUNT_STATUS_REJECTED,
    ACCOUNT_STATUS_SUSPENDED,
)
from users.models import UserAccount, UserProfile
from users.services.identity import IdentityVerificationService

User = get_user_model()
PUSH_TASK = "users.tasks.notifications.send_push_notification"
REFRESH = "users.admin.user_account.enqueue_for_account"
FIRST = datetime(2026, 3, 2, 9, 30, tzinfo=dt_timezone.utc)
LATER = FIRST + timedelta(days=40)


def at(moment):
    return patch("django.utils.timezone.now", return_value=moment)


def verdict(result):
    return NormalizedVerificationResult(
        verification_status="completed", review_result=result, is_verified=result == "GREEN"
    )


def an_account(label, citizenship="AU", **fields):
    user = User.objects.create_user(email=f"{label}@activation.example.test", password="pw-12345678")
    country, _ = Country.objects.get_or_create(code=citizenship, defaults={"name": citizenship})
    profile = UserProfile.objects.create(user=user, citizenship_country=country)
    return UserAccount.objects.create(account_number=f"ACC-{label.upper()}"[:20], user_profile=profile, **fields)


class IdentityCheckActivationTest(TestCase):
    def setUp(self):
        patch(PUSH_TASK).start()
        self.addCleanup(patch.stopall)

    def verify(self, account, result, moment):
        profile = UserProfile.objects.get(pk=account.user_profile_id)
        with at(moment):
            IdentityVerificationService.update_status_from_normalized(profile, verdict(result))
        account.refresh_from_db()
        return profile

    def test_a_passed_identity_check_activates_the_account_and_dates_it(self):
        account = an_account("green")

        profile = self.verify(account, "GREEN", FIRST)

        self.assertEqual((account.account_status, account.activation_date), (ACCOUNT_STATUS_ACTIVE, FIRST))
        self.assertEqual(profile.verified_at, FIRST)

    def test_a_second_passed_check_keeps_the_first_activation_date(self):
        account = an_account("again")

        self.verify(account, "GREEN", FIRST)
        self.verify(account, "RED", FIRST + timedelta(days=10))
        self.verify(account, "GREEN", LATER)

        self.assertEqual((account.account_status, account.activation_date), (ACCOUNT_STATUS_ACTIVE, FIRST))

    def test_a_passed_check_that_the_policy_rejects_leaves_the_account_undated(self):
        account = an_account("blacklisted", citizenship="KP")

        self.verify(account, "GREEN", FIRST)

        self.assertEqual((account.account_status, account.activation_date), (ACCOUNT_STATUS_REJECTED, None))


class ActivationOnSaveTest(TestCase):
    def test_an_account_created_active_is_dated(self):
        with at(FIRST):
            account = an_account("created-active", account_status=ACCOUNT_STATUS_ACTIVE)

        account.refresh_from_db()
        self.assertEqual(account.activation_date, FIRST)

    def test_saving_only_the_status_still_records_the_date(self):
        account = an_account("status-only")

        account.account_status = ACCOUNT_STATUS_ACTIVE
        with at(FIRST):
            account.save(update_fields=["account_status"])

        account.refresh_from_db()
        self.assertEqual(account.activation_date, FIRST)

    def test_suspending_and_reactivating_keeps_the_first_date(self):
        with at(FIRST):
            account = an_account("reactivated", account_status=ACCOUNT_STATUS_ACTIVE)

        account.account_status = ACCOUNT_STATUS_SUSPENDED
        account.save(update_fields=["account_status"])
        account.account_status = ACCOUNT_STATUS_ACTIVE
        with at(LATER):
            account.save(update_fields=["account_status"])

        account.refresh_from_db()
        self.assertEqual(account.activation_date, FIRST)

    def test_a_stale_copy_never_replaces_the_recorded_date(self):
        account = an_account("stale")
        stale = UserAccount.objects.get(pk=account.pk)

        account.account_status = ACCOUNT_STATUS_ACTIVE
        with at(FIRST):
            account.save()
        stale.account_status = ACCOUNT_STATUS_ACTIVE
        with at(LATER):
            stale.save()

        stale.refresh_from_db()
        self.assertEqual(stale.activation_date, FIRST)

    def test_pending_and_rejected_accounts_stay_undated(self):
        account = an_account("never-active")

        for status in (ACCOUNT_STATUS_PENDING, ACCOUNT_STATUS_REJECTED):
            account.account_status = status
            account.save()

        account.refresh_from_db()
        self.assertIsNone(account.activation_date)


class StaffActivationTest(TestCase):
    def setUp(self):
        self.client.force_login(User.objects.create_superuser(email="staff@activation.example.test", password="pw"))
        patch(REFRESH).start()
        self.addCleanup(patch.stopall)

    def change(self, account, status, **posted):
        return self.client.post(
            reverse("admin:users_useraccount_change", args=[account.pk]),
            {
                "user_profile": account.user_profile_id,
                "account_number": account.account_number,
                "account_type": account.account_type,
                "account_status": status,
                "role": account.role,
                "rejection_reason": "",
                **posted,
            },
        )

    def test_staff_activating_an_account_dates_it(self):
        account = an_account("staff-activated")

        with at(FIRST):
            response = self.change(account, ACCOUNT_STATUS_ACTIVE, activation_date_0="", activation_date_1="")

        self.assertEqual(response.status_code, 302, getattr(response, "context_data", response))
        account.refresh_from_db()
        self.assertEqual((account.account_status, account.activation_date), (ACCOUNT_STATUS_ACTIVE, FIRST))

    def test_staff_cannot_clear_or_move_the_recorded_date(self):
        with at(FIRST):
            account = an_account("staff-reactivated", account_status=ACCOUNT_STATUS_ACTIVE)
        account.account_status = ACCOUNT_STATUS_SUSPENDED
        account.save(update_fields=["account_status"])

        with at(LATER):
            cleared = self.change(account, ACCOUNT_STATUS_ACTIVE, activation_date_0="", activation_date_1="")
            moved = self.change(
                account, ACCOUNT_STATUS_ACTIVE, activation_date_0="2026-09-01", activation_date_1="10:00"
            )

        self.assertEqual((cleared.status_code, moved.status_code), (302, 302))
        account.refresh_from_db()
        self.assertEqual((account.account_status, account.activation_date), (ACCOUNT_STATUS_ACTIVE, FIRST))
