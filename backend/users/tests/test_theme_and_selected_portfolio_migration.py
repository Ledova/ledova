from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase
from django.utils import timezone

from portfolios.models import Portfolio
from shared.tests.schema import migrate_to, restore_every_migration
from users.models import UserAccount, UserPreferences, UserProfile

User = get_user_model()

BEFORE = [("users", "0027_transaction_alerts_on_user_preferences")]
AFTER = [("users", "0028_remove_theme_and_selected_portfolio")]
DROPPED = {"theme", "selected_portfolio_id"}


class ThemeAndSelectedPortfolioMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)

    def profile(self, label, *portfolios):
        user = User.objects.create_user(email=f"{label}@migration.example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user)
        if not portfolios:
            return profile, []
        account = UserAccount.objects.create(account_number=f"MIG-{label.upper()}"[:20], user_profile=profile)
        created = []
        for days_ago, name in portfolios:
            portfolio = Portfolio.objects.create(user_account=account, name=name)
            Portfolio.objects.filter(pk=portfolio.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
            created.append(portfolio)
        return profile, created

    def columns(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'users_userpreferences'"
            )
            return {row[0] for row in cursor.fetchall()}

    def test_the_columns_go_and_a_reversal_selects_each_accounts_first_portfolio_in_the_default_theme(self):
        chooser, (first, chosen) = self.profile("chooser", (2, "First"), (1, "Chosen"))
        unselected, (only,) = self.profile("unselected", (1, "Only"))
        without_account, _ = self.profile("without-account")

        before = migrate_to(BEFORE).get_model("users", "UserPreferences")
        before.objects.create(user_profile_id=chooser.pk, theme="light", selected_portfolio_id=chosen.pk)
        before.objects.create(user_profile_id=unselected.pk, transaction_alerts=False)
        before.objects.create(user_profile_id=without_account.pk, theme="light")

        after = migrate_to(AFTER).get_model("users", "UserPreferences")
        self.assertFalse(DROPPED & self.columns())
        self.assertFalse({"theme", "selected_portfolio"} & {field.name for field in after._meta.fields})
        self.assertEqual(
            dict(after.objects.values_list("user_profile_id", "transaction_alerts")),
            {chooser.pk: True, unselected.pk: False, without_account.pk: True},
        )

        reversed_model = migrate_to(BEFORE).get_model("users", "UserPreferences")
        self.assertEqual(
            {
                row[0]: row[1:]
                for row in reversed_model.objects.values_list("user_profile_id", "theme", "selected_portfolio_id")
            },
            {chooser.pk: ("dark", first.pk), unselected.pk: ("dark", only.pk), without_account.pk: ("dark", None)},
        )

        migrate_to(AFTER)
        self.assertFalse(DROPPED & self.columns())
        self.assertEqual(UserPreferences.objects.count(), 3)
