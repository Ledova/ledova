from uuid import uuid4

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from users.models import UserAccount, UserPreferences, UserProfile

User = get_user_model()

CLIENT_KEYS = {"uuid", "userProfile", "userAccount", "transactionAlerts"}


class UserPreferencesEndpointTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="prefs@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=self.user, full_name="Prefs Owner")
        self.account = UserAccount.objects.create(account_number="PREFS-A", user_profile=self.profile)
        self.client.force_authenticate(self.user)

    def post(self, **payload):
        return self.client.post("/api/user-preferences/", payload, format="json")

    def test_list_is_404_until_created_then_returns_client_keys(self):
        self.assertEqual(self.client.get("/api/user-preferences/").status_code, 404)

        created = self.post()
        self.assertEqual(created.status_code, 200, created.content)

        body = self.client.get("/api/user-preferences/").json()
        self.assertEqual(set(body), CLIENT_KEYS)
        self.assertEqual(set(body["userAccount"]), {"uuid", "accountNumber", "accountType", "activationDate", "role"})
        self.assertEqual(body["userAccount"]["uuid"], str(self.account.uuid))

    def test_post_upserts_the_single_row(self):
        first = self.post().json()
        second = self.post(transactionAlerts=False).json()

        self.assertEqual(first["uuid"], second["uuid"])
        self.assertEqual(UserPreferences.objects.filter(user_profile=self.profile).count(), 1)

    def test_an_old_client_sending_a_theme_or_selected_portfolio_is_answered_without_them(self):
        response = self.post(theme="light", selectedPortfolio=str(uuid4()), transactionAlerts=False)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.json()), CLIENT_KEYS)
        self.assertIs(response.json()["transactionAlerts"], False)

    def test_transaction_alerts_default_on_and_switch_off_through_the_upsert(self):
        created = self.post().json()
        self.assertIs(created["transactionAlerts"], True)

        switched = self.post(transactionAlerts=False).json()

        self.assertIs(switched["transactionAlerts"], False)
        self.assertFalse(UserPreferences.objects.get(user_profile=self.profile).transaction_alerts)
        self.assertIs(self.client.get("/api/user-preferences/").json()["transactionAlerts"], False)
