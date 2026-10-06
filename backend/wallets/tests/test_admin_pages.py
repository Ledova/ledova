from decimal import Decimal
from unittest.mock import patch

from django.contrib import admin
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from shared.db import acting_for, principal_of, use_operator
from shared.tests.tenants import make_tenant
from wallets.models import Holding, Transaction, Wallet

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=TEST_STORAGES)
class WalletsAdminPagesTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("walletadmin", superuser=True)
        self.client.force_login(self.tenant.user)
        self.instances = [
            self.tenant.wallet,
            self.tenant.holding,
            self.tenant.transaction,
        ]

    def test_every_wallets_model_is_registered_and_renders(self):
        registered = {model for model in admin.site._registry if model._meta.app_label == "wallets"}
        self.assertEqual(registered, {type(instance) for instance in self.instances})

        for instance in self.instances:
            info = (instance._meta.app_label, instance._meta.model_name)
            with self.subTest(model=instance._meta.label):
                self.assertEqual(self.client.get(reverse("admin:%s_%s_changelist" % info)).status_code, 200)
                self.assertEqual(
                    self.client.get(reverse("admin:%s_%s_change" % info, args=[instance.pk])).status_code, 200
                )
        self.assertEqual(self.client.get(reverse("admin:wallets_wallet_add")).status_code, 200)

    def test_a_transaction_shows_its_aud_value_read_only_beside_its_usd_value(self):
        transaction = self.tenant.transaction
        Transaction.objects.filter(pk=transaction.pk).update(
            market_value=Decimal("1000.00"), market_value_aud=Decimal("1524.00")
        )

        listed = self.client.get(reverse("admin:wallets_transaction_changelist"))
        detail = self.client.get(reverse("admin:wallets_transaction_change", args=[transaction.pk]))

        self.assertContains(listed, "A$1,524.00")
        self.assertContains(detail, "1524.00")
        self.assertIn("market_value", detail.context["adminform"].form.fields)
        self.assertNotIn("market_value_aud", detail.context["adminform"].form.fields)

    def test_holdings_count_is_annotated_and_survives_the_profile_join_of_search(self):
        Holding.objects.create(wallet=self.tenant.wallet, asset=self.tenant.refs.spare_asset, quantity=Decimal("1"))
        url = reverse("admin:wallets_wallet_changelist")

        response = self.client.get(url, {"q": self.tenant.user.email, "o": "5"})

        counts = {row.pk: row.holdings_count for row in response.context["cl"].result_list}
        self.assertEqual(counts, {self.tenant.wallet.pk: 2, self.tenant.spare_wallet.pk: 0})

    def test_wallet_actions_verify_and_queue_syncs(self):
        url = reverse("admin:wallets_wallet_changelist")
        self.client.post(url, {"action": "verify_wallets", "_selected_action": [self.tenant.spare_wallet.pk]})
        spare = Wallet.objects.get(pk=self.tenant.spare_wallet.pk)
        self.assertTrue(spare.is_verified)
        self.assertIsNotNone(spare.verified_at)

        with patch("wallets.tasks.sync_wallet") as sync_wallet:
            self.client.post(url, {"action": "sync_holdings_action", "_selected_action": [spare.pk]})
        sync_wallet.defer.assert_called_once_with(wallet_uuid=str(spare.uuid), principal_id=None)

    def wallet_change_data(self, wallet):
        return {
            "user_account": str(wallet.user_account_id),
            "name": "Synthetic admin name",
            "address": wallet.address,
            "chain": wallet.chain,
            "verification_status": wallet.verification_status,
        }

    def test_an_actual_wallet_change_keeps_its_account_and_updates_the_name(self):
        wallet = self.tenant.spare_wallet
        self.client.raise_request_exception = False
        response = self.client.post(
            reverse("admin:wallets_wallet_change", args=[wallet.pk]), self.wallet_change_data(wallet)
        )
        self.assertEqual(response.status_code, 302, response.content)
        wallet.refresh_from_db()
        self.assertEqual(wallet.name, "Synthetic admin name")
        self.assertEqual(wallet.user_account_id, self.tenant.account.pk)

    def test_an_actual_single_wallet_delete_keeps_unrelated_wallet_records(self):
        wallet = self.tenant.spare_wallet
        self.client.raise_request_exception = False
        response = self.client.post(reverse("admin:wallets_wallet_delete", args=[wallet.pk]), {"post": "yes"})
        self.assertEqual(response.status_code, 302, response.content)
        self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
        self.assertTrue(Wallet.objects.filter(pk=self.tenant.wallet.pk).exists())
        self.assertTrue(Holding.objects.filter(pk=self.tenant.holding.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=self.tenant.transaction.pk).exists())

    def test_an_actual_bulk_wallet_delete_keeps_unselected_wallet_records(self):
        wallet = self.tenant.spare_wallet
        self.client.raise_request_exception = False
        response = self.client.post(
            reverse("admin:wallets_wallet_changelist"),
            {"action": "delete_selected", "_selected_action": [str(wallet.pk)], "post": "yes"},
        )
        self.assertEqual(response.status_code, 302, response.content)
        self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
        self.assertTrue(Wallet.objects.filter(pk=self.tenant.wallet.pk).exists())
        self.assertTrue(Holding.objects.filter(pk=self.tenant.holding.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=self.tenant.transaction.pk).exists())

    def test_a_staff_member_without_wallet_permissions_cannot_change_or_delete(self):
        actor = make_tenant("walletadmin-no-write", staff=True)
        wallet = self.tenant.spare_wallet
        before = Wallet.objects.filter(pk=wallet.pk).values().get()
        self.client.force_login(actor.user)
        requests = (
            (reverse("admin:wallets_wallet_change", args=[wallet.pk]), self.wallet_change_data(wallet)),
            (reverse("admin:wallets_wallet_delete", args=[wallet.pk]), {"post": "yes"}),
            (
                reverse("admin:wallets_wallet_changelist"),
                {"action": "delete_selected", "_selected_action": [str(wallet.pk)], "post": "yes"},
            ),
        )
        for url, data in requests:
            with self.subTest(url=url):
                response = self.client.post(url, data)
                self.assertEqual(response.status_code, 403, response.content)
                self.assertEqual(Wallet.objects.filter(pk=wallet.pk).values().get(), before)

    def test_each_admin_write_restores_an_existing_caller_principal(self):
        caller = make_tenant("walletadmin-caller")
        request = RequestFactory().post("/admin/")
        request.user = self.tenant.user
        model_admin = admin.site._registry[Wallet]
        for operation in ("save", "delete", "bulk"):
            with self.subTest(operation=operation), use_operator(), acting_for(caller.user.pk):
                wallet = Wallet.objects.create(
                    user_account=self.tenant.account, chain="bitcoin", address=f"synthetic-wallet-{operation}"
                )
                if operation == "save":
                    wallet.name = "Synthetic restored caller"
                    model_admin.save_model(request, wallet, None, True)
                elif operation == "delete":
                    model_admin.delete_model(request, wallet)
                else:
                    model_admin.delete_queryset(request, Wallet.objects.filter(pk=wallet.pk))
                self.assertEqual(principal_of(), str(caller.user.pk))
