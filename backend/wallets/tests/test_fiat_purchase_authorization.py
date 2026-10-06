from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITransactionTestCase

from operators.models import Operator
from users.models import UserAccount, UserProfile
from users.models.user_account import AccountRole
from wallets.models import Wallet

User = get_user_model()


class FiatPurchaseAuthorizationTest(APITransactionTestCase):
    def make_tenant(self, label):
        user = User.objects.create_user(email=f"{label}@fiat.example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user)
        account = UserAccount.objects.create(account_number=f"FIAT-{label.upper()}", user_profile=profile)
        wallet = Wallet.objects.create(
            user_account=account,
            address="0x" + ("a" if label == "alice" else "b") * 40,
            chain="ethereum",
        )
        return user, profile, account, wallet

    def setUp(self):
        Operator.get()
        self.alice, self.alice_profile, self.alice_account, self.alice_wallet = self.make_tenant("alice")
        self.bob, self.bob_profile, self.bob_account, self.bob_wallet = self.make_tenant("bob")
        self.client.force_authenticate(self.alice)

    def test_widget_requires_authentication(self):
        self.client.force_authenticate(None)

        response = self.client.post(
            "/api/fiat-purchases/transak-widget-url/",
            {"walletUuid": str(self.alice_wallet.uuid)},
            format="json",
        )

        self.assertEqual(response.status_code, 401)

    @patch("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.example.test")
    def test_widget_accepts_owned_wallet_and_masks_foreign_wallet_existence(self, generate_widget_url):
        action_url = "/api/fiat-purchases/transak-widget-url/"
        own_response = self.client.post(
            action_url,
            {
                "walletUuid": str(self.alice_wallet.uuid),
                "chain": "base",
                "email": "attacker@example.test",
                "disableWalletAddressForm": False,
                "productsAvailed": "SELL",
            },
            format="json",
        )

        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(own_response.json()["walletAddress"], self.alice_wallet.address)
        generate_widget_url.assert_called_once()
        self.assertEqual(generate_widget_url.call_args.kwargs["wallet_address"], self.alice_wallet.address)
        self.assertEqual(generate_widget_url.call_args.kwargs["chain"], self.alice_wallet.chain)
        self.assertEqual(generate_widget_url.call_args.kwargs["email"], self.alice.email)
        self.assertTrue(generate_widget_url.call_args.kwargs["disable_wallet_address_form"])
        self.assertEqual(generate_widget_url.call_args.kwargs["products_availed"], "BUY")

        foreign_response = self.client.post(
            action_url,
            {"walletUuid": str(self.bob_wallet.uuid)},
            format="json",
        )
        missing_response = self.client.post(
            action_url,
            {"walletUuid": str(uuid4())},
            format="json",
        )
        self.assertEqual(foreign_response.status_code, 404)
        self.assertEqual(missing_response.status_code, 404)
        self.assertEqual(foreign_response.json(), missing_response.json())
        self.assertNotIn(self.bob_wallet.address, foreign_response.content.decode())
        generate_widget_url.assert_called_once()

    @patch("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.example.test")
    def test_company_account_cannot_purchase_crypto_with_an_owned_wallet(self, generate_widget_url):
        self.alice_account.role = AccountRole.COMPANY
        self.alice_account.save(update_fields=["role"])

        response = self.client.post(
            "/api/fiat-purchases/transak-widget-url/",
            {
                "walletUuid": str(self.alice_wallet.uuid),
                "role": AccountRole.INVESTOR,
                "userAccountUuid": str(self.bob_account.uuid),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json(), {"detail": "Crypto purchases require a personal investor account."})
        generate_widget_url.assert_not_called()

    @patch("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.example.test")
    def test_company_refusal_does_not_disclose_foreign_wallet_existence(self, generate_widget_url):
        self.alice_account.role = AccountRole.COMPANY
        self.alice_account.save(update_fields=["role"])

        foreign_response = self.client.post(
            "/api/fiat-purchases/transak-widget-url/",
            {"walletUuid": str(self.bob_wallet.uuid)},
            format="json",
        )
        missing_response = self.client.post(
            "/api/fiat-purchases/transak-widget-url/",
            {"walletUuid": str(uuid4())},
            format="json",
        )

        self.assertEqual(foreign_response.status_code, 403, foreign_response.content)
        self.assertEqual(missing_response.status_code, 403, missing_response.content)
        self.assertEqual(foreign_response.json(), missing_response.json())
        self.assertNotIn(self.bob_wallet.address, foreign_response.content.decode())
        generate_widget_url.assert_not_called()

    @patch("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.example.test")
    def test_missing_personal_account_cannot_purchase_crypto(self, generate_widget_url):
        self.alice_account.delete()

        response = self.client.post(
            "/api/fiat-purchases/transak-widget-url/",
            {"walletUuid": str(self.bob_wallet.uuid)},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json(), {"detail": "Crypto purchases require a personal investor account."})
        generate_widget_url.assert_not_called()

    @patch("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.example.test")
    def test_both_role_preserves_personal_crypto_purchases(self, generate_widget_url):
        self.alice_account.role = AccountRole.BOTH
        self.alice_account.save(update_fields=["role"])

        response = self.client.post(
            "/api/fiat-purchases/transak-widget-url/",
            {"walletUuid": str(self.alice_wallet.uuid)},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["walletAddress"], self.alice_wallet.address)
        generate_widget_url.assert_called_once()

    @patch("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.example.test")
    def test_each_provider_request_checks_the_current_role_after_account_updates(self, generate_widget_url):
        account_url = reverse("user-accounts-detail", args=[self.alice_account.uuid])
        widget_url = "/api/fiat-purchases/transak-widget-url/"
        cached_account = self.alice.userprofile.user_account

        allowed_response = self.client.post(widget_url, {"walletUuid": str(self.alice_wallet.uuid)}, format="json")
        company_response = self.client.patch(account_url, {"role": AccountRole.COMPANY}, format="json")
        denied_response = self.client.post(widget_url, {"walletUuid": str(self.alice_wallet.uuid)}, format="json")

        self.assertEqual(allowed_response.status_code, 200, allowed_response.content)
        self.assertEqual(company_response.status_code, 200, company_response.content)
        self.assertEqual(cached_account.role, AccountRole.INVESTOR)
        self.assertEqual(denied_response.status_code, 403, denied_response.content)
        generate_widget_url.assert_called_once()

        investor_response = self.client.patch(account_url, {"role": AccountRole.INVESTOR}, format="json")
        restored_response = self.client.post(widget_url, {"walletUuid": str(self.alice_wallet.uuid)}, format="json")

        self.assertEqual(investor_response.status_code, 200, investor_response.content)
        self.assertEqual(restored_response.status_code, 200, restored_response.content)
        self.assertEqual(generate_widget_url.call_count, 2)
