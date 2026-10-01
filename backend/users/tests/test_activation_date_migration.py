from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase

from shared.tests.schema import migrate_to, restore_every_migration
from users.models import UserProfile

User = get_user_model()

BEFORE = [
    ("users", "0028_remove_theme_and_selected_portfolio"),
    ("compliance", "0005_remove_fiat_transaction_and_high_risk_country"),
]
AFTER = [("users", "0029_first_activation_date")]
JOINED = datetime(2025, 11, 3, 8, 0, tzinfo=dt_timezone.utc)
VERIFIED = JOINED + timedelta(days=2)
REVERIFIED = VERIFIED + timedelta(days=60)
STAFF_DATED = VERIFIED + timedelta(days=9)


class ActivationDateBackfillTest(TransactionTestCase):
    def tearDown(self):
        restore_every_migration()
        super().tearDown()

    def account(self, apps, label, status, verified_at=None, **fields):
        user = User.objects.create_user(email=f"{label}@backfill.example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user, verified_at=verified_at, is_id_verified=bool(verified_at))
        accounts = apps.get_model("users", "UserAccount").objects
        row = accounts.create(
            user_profile_id=profile.pk, account_number=f"ACC-{label.upper()}"[:20], account_status=status, **fields
        )
        accounts.filter(pk=row.pk).update(created_at=JOINED)
        return row.pk

    def assessed(self, apps, account, valid_from, automated=True):
        apps.get_model("compliance", "CustomerRiskAssessment").objects.create(
            user_account_id=account, assessment_status="complete", is_automated=automated, valid_from=valid_from
        )

    def dates(self, apps):
        return dict(apps.get_model("users", "UserAccount").objects.values_list("pk", "activation_date"))

    def guarded(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_trigger WHERE tgname = 'users_keep_first_activation'")
            return cursor.fetchone()[0] == 1

    def test_each_account_that_was_ever_active_is_dated_from_the_best_evidence_it_has(self):
        before = migrate_to(BEFORE)
        verified = self.account(before, "verified", "active", verified_at=VERIFIED)
        self.assessed(before, verified, VERIFIED + timedelta(seconds=1))
        reverified = self.account(before, "reverified", "active", verified_at=REVERIFIED)
        self.assessed(before, reverified, VERIFIED)
        self.assessed(before, reverified, REVERIFIED)
        assessed_only = self.account(before, "assessed-only", "active")
        self.assessed(before, assessed_only, VERIFIED)
        suspended = self.account(before, "suspended", "suspended", verified_at=VERIFIED)
        terminated = self.account(before, "terminated", "terminated")
        manual = self.account(before, "manual", "active")
        self.assessed(before, manual, VERIFIED, automated=False)
        dated = self.account(before, "dated", "active", verified_at=VERIFIED, activation_date=STAFF_DATED)
        pending = self.account(before, "pending", "pending", verified_at=VERIFIED)
        rejected = self.account(before, "rejected", "rejected", verified_at=VERIFIED)

        dates = self.dates(migrate_to(AFTER))
        self.assertTrue(self.guarded())

        self.assertEqual(
            [dates[account] for account in (verified, reverified, assessed_only, suspended)], [VERIFIED] * 4
        )
        self.assertEqual([dates[account] for account in (terminated, manual)], [JOINED, JOINED])
        self.assertEqual(dates[dated], STAFF_DATED)
        self.assertEqual([dates[pending], dates[rejected]], [None, None])
        self.assertEqual(self.dates(migrate_to(BEFORE)), dates)
        self.assertFalse(self.guarded())
