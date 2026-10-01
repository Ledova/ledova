from unittest import skipUnless

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from shared.tests.schema import restore_every_migration
from users.models import UserProfile

User = get_user_model()
BEFORE = ("users", "0028_remove_theme_and_selected_portfolio")
AFTER = ("users", "0029_kyc_results_in_the_fields_choices")
MIGRATIONS_ENABLED = getattr(settings, "MIGRATION_MODULES", {}).get("users", "users.migrations") is not None
WRITTEN_BEFORE_THE_FIX = {
    "never-started": (None, None),
    "unused": ("unused", ""),
    "pending": ("pending", ""),
    "queued": ("queued", None),
    "approved": ("completed", "GREEN"),
    "declined": ("completed", "RED"),
}


@skipUnless(MIGRATIONS_ENABLED, "The KYC results migration must run")
class KYCResultsMigrationTest(TransactionTestCase):
    def test_rows_written_before_the_mapping_fix_read_as_the_mappings_now_record_them(self):
        self.addCleanup(restore_every_migration)
        MigrationExecutor(connection).migrate([BEFORE])
        for key, (status, result) in WRITTEN_BEFORE_THE_FIX.items():
            user = User.objects.create_user(email=f"{key}@example.test", password="pw-12345678")
            UserProfile.objects.create(user=user, verification_status=status, review_result=result)

        MigrationExecutor(connection).migrate([AFTER])

        recorded = {
            email.split("@")[0]: (status, result)
            for email, status, result in UserProfile.objects.values_list(
                "user__email", "verification_status", "review_result"
            )
        }
        self.assertEqual(
            recorded,
            {
                "never-started": (None, None),
                "unused": ("init", None),
                "pending": ("pending", None),
                "queued": ("queued", None),
                "approved": ("completed", "GREEN"),
                "declined": ("completed", "RED"),
            },
        )
