from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase

from portfolios.models import Portfolio
from users.models import UserAccount, UserPreferences, UserProfile
from users.services.setup import ensure_defaults

User = get_user_model()


class EnsureDefaultsTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="defaults@example.test", password="pw-12345678")

    def test_new_user_gets_profile_account_portfolio_and_preferences(self):
        profile, account, portfolio, preferences = ensure_defaults(self.user)

        self.assertEqual(profile.user, self.user)
        self.assertEqual(account.account_number, f"ACC-{self.user.id:06d}")
        self.assertEqual(account.user_profile, profile)
        self.assertEqual(portfolio.user_account, account)
        self.assertEqual(portfolio.name, "My Portfolio")
        self.assertEqual(preferences.user_profile, profile)

    def test_second_call_reuses_every_row(self):
        first = ensure_defaults(self.user)

        second = ensure_defaults(self.user)

        self.assertEqual([row.pk for row in first], [row.pk for row in second])
        self.assertEqual(UserAccount.objects.filter(user_profile__user=self.user).count(), 1)
        self.assertEqual(Portfolio.objects.filter(user_account__user_profile__user=self.user).count(), 1)
        self.assertEqual(UserPreferences.objects.filter(user_profile__user=self.user).count(), 1)

    def test_existing_account_without_portfolio_gets_one_and_keeps_its_preferences(self):
        profile = UserProfile.objects.create(user=self.user)
        account = UserAccount.objects.create(account_number="EXISTING", user_profile=profile)
        preferences = UserPreferences.objects.create(user_profile=profile, transaction_alerts=False)

        _, returned_account, portfolio, returned_preferences = ensure_defaults(self.user)

        self.assertEqual(returned_account, account)
        self.assertEqual(list(account.portfolios.all()), [portfolio])
        self.assertEqual(returned_preferences.pk, preferences.pk)
        preferences.refresh_from_db()
        self.assertFalse(preferences.transaction_alerts)

    def test_an_account_that_has_portfolios_gets_its_oldest_and_no_new_one(self):
        profile = UserProfile.objects.create(user=self.user)
        account = UserAccount.objects.create(account_number="EXISTING", user_profile=profile)
        newer = Portfolio.objects.create(user_account=account, name="Newer")
        older = Portfolio.objects.create(user_account=account, name="Older")
        Portfolio.objects.filter(pk=older.pk).update(created_at=newer.created_at - timedelta(days=1))

        _, _, portfolio, _ = ensure_defaults(self.user)

        self.assertEqual(portfolio, older)
        self.assertEqual(account.portfolios.count(), 2)
