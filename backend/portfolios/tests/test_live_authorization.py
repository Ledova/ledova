from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from portfolios.models import Portfolio
from users.models import UserAccount, UserProfile
from wallets.models import Wallet

User = get_user_model()


class PortfolioFixtureMixin:
    def make_tenant(self, label):
        user = User.objects.create_user(email=f"{label}@portfolio.example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user)
        account = UserAccount.objects.create(account_number=f"ACCOUNT-{label.upper()}", user_profile=profile)
        portfolio = Portfolio.objects.create(user_account=account, name=f"{label.title()} Portfolio")
        wallet = Wallet.objects.create(
            user_account=account,
            address="0x" + ("a" if label == "alice" else "b") * 40,
            chain="ethereum",
        )
        return user, profile, account, portfolio, wallet

    @staticmethod
    def rows(response):
        body = response.json()
        return body.get("results", body) if isinstance(body, dict) else body


class PortfolioEndpointIsolationTest(PortfolioFixtureMixin, APITestCase):
    def setUp(self):
        self.alice, self.alice_profile, self.alice_account, self.alice_portfolio, self.alice_wallet = self.make_tenant(
            "alice"
        )
        self.bob, self.bob_profile, self.bob_account, self.bob_portfolio, self.bob_wallet = self.make_tenant("bob")
        self.client.force_authenticate(self.alice)

    def test_portfolio_list_filter_cannot_expand_the_live_scope(self):
        filtered_response = self.client.get(
            "/api/portfolios/",
            {"user_profile": str(self.alice_profile.uuid)},
        )
        self.assertEqual(filtered_response.status_code, 200)
        self.assertEqual(
            {row["uuid"] for row in self.rows(filtered_response)},
            {str(self.alice_portfolio.uuid)},
        )

        foreign_filter = self.client.get("/api/portfolios/", {"user_profile": str(self.bob_profile.uuid)})
        self.assertEqual(foreign_filter.status_code, 200)
        self.assertNotIn(str(self.bob_portfolio.uuid), {row["uuid"] for row in self.rows(foreign_filter)})

    def test_own_wallet_can_be_added_and_removed(self):
        add_response = self.client.post(
            f"/api/portfolios/{self.alice_portfolio.uuid}/add-wallet/",
            {"walletUuid": str(self.alice_wallet.uuid)},
            format="json",
        )
        self.assertEqual(add_response.status_code, 200)
        self.assertEqual(add_response.json()["portfolio"]["walletUuids"], [str(self.alice_wallet.uuid)])
        self.assertTrue(self.alice_portfolio.wallets.filter(pk=self.alice_wallet.pk).exists())

        remove_response = self.client.post(
            f"/api/portfolios/{self.alice_portfolio.uuid}/remove-wallet/",
            {"walletUuid": str(self.alice_wallet.uuid)},
            format="json",
        )
        self.assertEqual(remove_response.status_code, 200)
        self.assertEqual(remove_response.json()["portfolio"]["walletUuids"], [])
        self.assertFalse(self.alice_portfolio.wallets.filter(pk=self.alice_wallet.pk).exists())

    def test_inconsistent_foreign_wallet_link_is_hidden_from_portfolio_output(self):
        self.alice_portfolio.wallets.add(self.alice_wallet, self.bob_wallet)

        response = self.client.get(f"/api/portfolios/{self.alice_portfolio.uuid}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["walletUuids"], [str(self.alice_wallet.uuid)])
        self.assertEqual(response.json()["walletCount"], 1)

        remove_response = self.client.post(
            f"/api/portfolios/{self.alice_portfolio.uuid}/remove-wallet/",
            {"walletUuid": str(self.bob_wallet.uuid)},
            format="json",
        )
        self.assertEqual(remove_response.status_code, 404)
        self.assertTrue(self.alice_portfolio.wallets.filter(pk=self.bob_wallet.pk).exists())


class PortfolioCreateAccountSelectionTest(PortfolioFixtureMixin, APITestCase):
    def setUp(self):
        self.alice, self.alice_profile, self.account_a, _, _ = self.make_tenant("alice")
        self.bob, _, self.bob_account, _, _ = self.make_tenant("bob")
        self.client.force_authenticate(self.alice)

    def _create(self, payload):
        return self.client.post("/api/portfolios/", payload, format="json")

    def test_defaults_to_the_one_account(self):
        response = self._create({"name": "Defaulted"})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["userAccount"], str(self.account_a.uuid))
        self.assertEqual(Portfolio.objects.get(name="Defaulted").user_account, self.account_a)

    def test_a_named_account_is_ignored_and_the_portfolio_lands_on_the_callers(self):
        response = self._create({"name": "Stolen", "userAccount": str(self.bob_account.uuid)})

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Portfolio.objects.get(name="Stolen").user_account, self.account_a)
