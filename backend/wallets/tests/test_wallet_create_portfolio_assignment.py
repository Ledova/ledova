from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from portfolios.models import Portfolio
from shared.tests.tenants import an_account
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from wallets.services.registration import register_wallet

User = get_user_model()


class WalletCreatePortfolioAssignmentTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="wallet-create@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=self.user)
        self.account = UserAccount.objects.create(account_number="WALLET-CREATE", user_profile=self.profile)
        self.portfolio = Portfolio.objects.create(user_account=self.account, name="My Portfolio")

        self.client.force_authenticate(User.objects.get(pk=self.user.pk))

    def create_wallet(self, address_character):
        response = self.client.post(
            "/api/wallets/",
            {"userAccount": str(self.account.uuid), "address": "0x" + address_character * 40, "chain": "ethereum"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        return Wallet.objects.get(uuid=response.json()["uuid"])

    def test_a_new_wallet_joins_the_accounts_first_portfolio_only(self):
        later = Portfolio.objects.create(user_account=self.account, name="Later portfolio")
        Portfolio.objects.filter(pk=later.pk).update(created_at=timezone.now() + timedelta(days=1))

        wallet = self.create_wallet("a")

        self.assertEqual(wallet.verification_status, "PENDING")
        self.assertEqual(list(wallet.portfolios.all()), [self.portfolio])

    def test_an_older_portfolio_of_another_account_never_receives_the_wallet(self):
        foreign_account = an_account("wallet-create-portfolio-assi", account_number="WALLET-FOREIGN")
        foreign_portfolio = Portfolio.objects.create(user_account=foreign_account, name="Foreign portfolio")
        Portfolio.objects.filter(pk=foreign_portfolio.pk).update(created_at=timezone.now() - timedelta(days=1))

        wallet = self.create_wallet("b")

        self.assertEqual(list(wallet.portfolios.all()), [self.portfolio])
        self.assertFalse(foreign_portfolio.wallets.exists())

    def test_the_service_scopes_to_the_account_where_no_policy_would(self):
        foreign_account = an_account("wallet-create-service-foreig", account_number="WALLET-SERVICE")
        foreign_portfolio = Portfolio.objects.create(user_account=foreign_account, name="Foreign portfolio")
        Portfolio.objects.filter(pk=foreign_portfolio.pk).update(created_at=timezone.now() - timedelta(days=1))

        wallet = register_wallet(user_account=self.account, address="0x" + "e" * 40, chain="ethereum")

        self.assertEqual(list(wallet.portfolios.all()), [self.portfolio])
        self.assertFalse(foreign_portfolio.wallets.exists())

    def test_an_account_with_no_portfolio_still_registers_the_wallet(self):
        self.portfolio.delete()

        wallet = self.create_wallet("c")

        self.assertFalse(wallet.portfolios.exists())

    def test_duplicate_address_in_the_same_account_is_rejected_by_validation(self):
        self.create_wallet("d")

        response = self.client.post(
            "/api/wallets/",
            {"userAccount": str(self.account.uuid), "address": "0x" + "d" * 40, "chain": "ethereum"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Wallet.objects.filter(user_account=self.account).count(), 1)
