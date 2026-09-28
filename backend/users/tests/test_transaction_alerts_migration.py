from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase

from shared.tests.schema import migrate_to, restore_every_migration
from users.models import UserPreferences, UserProfile

User = get_user_model()

BEFORE = [("users", "0026_delete_favouriteasset")]
AFTER = [("users", "0027_transaction_alerts_on_user_preferences")]


class TransactionAlertsMigrationTest(TransactionTestCase):
    def tearDown(self):
        restore_every_migration()
        super().tearDown()

    def profile(self, label):
        user = User.objects.create_user(email=f"{label}@migration.example.test", password="pw-12345678")
        return UserProfile.objects.create(user=user)

    def fields_of(self, apps):
        return {field.name for field in apps.get_model("users", "UserPreferences")._meta.fields}

    def table_exists(self, name):
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [name])
            return cursor.fetchone()[0]

    def test_a_disabled_switch_survives_the_merge_and_everyone_else_keeps_the_default(self):
        muted = self.profile("muted")
        muted_without_a_row = self.profile("muted-without-a-row")
        defaulted = self.profile("defaulted")

        before = migrate_to(BEFORE)
        self.assertNotIn("transaction_alerts", self.fields_of(before))
        notification_preferences = before.get_model("users", "NotificationPreferences")
        preferences = before.get_model("users", "UserPreferences")
        existing = preferences.objects.create(user_profile_id=muted.pk, theme="light")
        preferences.objects.create(user_profile_id=defaulted.pk)
        notification_preferences.objects.create(user_profile_id=muted.pk, transaction_alerts=False)
        notification_preferences.objects.create(user_profile_id=muted_without_a_row.pk, transaction_alerts=False)

        after = migrate_to(AFTER)
        with self.assertRaises(LookupError):
            after.get_model("users", "NotificationPreferences")
        self.assertFalse(self.table_exists("users_notification_preferences"))
        merged = after.get_model("users", "UserPreferences")
        self.assertEqual(merged.objects.count(), 3)
        carried = merged.objects.get(user_profile_id=muted.pk)
        self.assertEqual((carried.pk, carried.theme, carried.transaction_alerts), (existing.pk, "light", False))
        created = merged.objects.get(user_profile_id=muted_without_a_row.pk)
        self.assertEqual(
            (created.theme, created.selected_portfolio_id, created.transaction_alerts), ("dark", None, False)
        )
        self.assertTrue(merged.objects.get(user_profile_id=defaulted.pk).transaction_alerts)

        reversed_apps = migrate_to(BEFORE)
        self.assertEqual(reversed_apps.get_model("users", "NotificationPreferences").objects.count(), 0)
        self.assertNotIn("transaction_alerts", self.fields_of(reversed_apps))
        migrate_to(AFTER)
        self.assertTrue(UserPreferences.objects.get(user_profile=muted).transaction_alerts)
