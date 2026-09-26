from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from assets.models import Asset
from portfolios.models import Portfolio
from users.models import (
    DeviceToken,
    FavouriteAsset,
    FinancialProfile,
    InvestorCategory,
    InvestorClassification,
    Notification,
    NotificationPreferences,
    UserAccount,
    UserPreferences,
    UserProfile,
)

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=TEST_STORAGES)
class UsersAdminPagesTest(TestCase):

    def setUp(self):
        self.admin = User.objects.create_superuser(email="admin@example.test", password="pw-12345678")
        self.client.force_login(self.admin)
        user = User.objects.create_user(email="member@example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user, full_name="Member", phone_country_code="+61", phone_number="4")
        account = UserAccount.objects.create(account_number="ADMIN-ACC", user_profile=profile)
        portfolio = Portfolio.objects.create(user_account=account, name="Admin portfolio")
        asset = Asset.objects.create(symbol="ADM", name="Admin asset", asset_type="tokenized_security", is_active=True)
        self.instances = [
            profile,
            account,
            FinancialProfile.objects.create(user_profile=profile, occupation="Tester"),
            UserPreferences.objects.create(user_profile=profile, selected_portfolio=portfolio),
            NotificationPreferences.objects.create(user_profile=profile),
            FavouriteAsset.objects.create(user_account=account, asset=asset),
            DeviceToken.objects.create(user=user, push_token="ExponentPushToken[admin]", device_type="ios"),
            Notification.objects.create(user=user, title="Hello", body="Body"),
            InvestorClassification.objects.create(
                user_account=account,
                category=InvestorCategory.PROFESSIONAL_INVESTOR,
                declaration_accepted=True,
                declaration_text="Declared",
            ),
        ]

    def test_the_bulk_actions_switch_transaction_alerts_off_and_on(self):
        preferences = next(item for item in self.instances if isinstance(item, NotificationPreferences))
        url = reverse("admin:users_notificationpreferences_changelist")

        for action, expected in (("disable_transaction_alerts", False), ("enable_transaction_alerts", True)):
            with self.subTest(action=action):
                response = self.client.post(url, {"action": action, "_selected_action": [str(preferences.pk)]})

                self.assertEqual(response.status_code, 302)
                preferences.refresh_from_db()
                self.assertIs(preferences.transaction_alerts, expected)

    def test_every_users_model_is_registered_and_renders(self):
        registered = {model for model in admin.site._registry if model._meta.app_label == "users"}
        self.assertEqual(registered, {type(instance) for instance in self.instances})

        for instance in self.instances:
            info = (instance._meta.app_label, instance._meta.model_name)
            with self.subTest(model=instance._meta.label):
                self.assertEqual(self.client.get(reverse("admin:%s_%s_changelist" % info)).status_code, 200)
                self.assertEqual(self.client.get(reverse("admin:%s_%s_add" % info)).status_code, 200)
                self.assertEqual(
                    self.client.get(reverse("admin:%s_%s_change" % info, args=[instance.pk])).status_code, 200
                )
