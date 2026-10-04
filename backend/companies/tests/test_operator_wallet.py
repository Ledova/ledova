from django.contrib.auth.models import Permission
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from companies.tests.test_document_file_access import legacy_company_administrators
from shared.db import use_migrate
from shared.tests.tenants import make_tenant
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


class OperatorWalletApiTest(APITransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("owner")
        self.other = make_tenant("other")
        legacy_company_administrators(self.tenant.company, self.other.company)
        self.client.force_authenticate(self.tenant.user)
        self.url = f"/api/v1/companies/{self.tenant.company.uuid}/"
        with use_migrate():
            Company.objects.filter(pk=self.tenant.company.pk).update(operator_wallet=None)

    def _patch(self, wallet):
        return self.client.patch(self.url, {"operatorWallet": wallet}, format="json")

    def test_owner_sets_clears_and_reads_a_verified_evm_wallet(self):
        response = self._patch(str(self.tenant.wallet.uuid))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["operatorWallet"], str(self.tenant.wallet.uuid))
        self.tenant.company.refresh_from_db()
        self.assertEqual(self.tenant.company.operator_wallet, self.tenant.wallet)
        self.assertEqual(self.client.get(self.url).json()["operatorWallet"], str(self.tenant.wallet.uuid))

        cleared = self._patch(None)
        self.assertEqual(cleared.status_code, 200, cleared.content)
        self.tenant.company.refresh_from_db()
        self.assertIsNone(self.tenant.company.operator_wallet)

    def test_unverified_foreign_and_non_evm_wallets_are_rejected(self):
        bitcoin = Wallet.objects.create(
            user_account=self.tenant.account,
            address="tb1q" + "0" * 38,
            chain="bitcoin",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )
        for wallet in (self.tenant.spare_wallet, self.other.wallet, bitcoin):
            with self.subTest(wallet=wallet.chain):
                response = self._patch(str(wallet.uuid))
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("operatorWallet", response.json())
        self.tenant.company.refresh_from_db()
        self.assertIsNone(self.tenant.company.operator_wallet)


@override_settings(STORAGES=TEST_STORAGES)
class OperatorWalletAdminTest(TransactionTestCase):
    def test_change_form_offers_only_the_actors_verified_evm_wallets(self):
        tenant = make_tenant("owner")
        other = make_tenant("other")
        legacy_company_administrators(tenant.company, other.company)
        tenant.user.is_staff = True
        tenant.user.save(update_fields=["is_staff"])
        tenant.user.user_permissions.add(
            Permission.objects.get(codename="change_company"), Permission.objects.get(codename="view_company")
        )
        self.client.force_login(tenant.user)
        page = self.client.get(reverse("admin:companies_company_change", args=[tenant.company.pk]))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, 'name="operator_wallet"')
        options = page.context["adminform"].form.fields["operator_wallet"].queryset
        self.assertEqual(list(options), [tenant.wallet])
        self.assertNotIn(tenant.spare_wallet, options)
        self.assertNotIn(other.wallet, options)

        add_page = self.client.get(reverse("admin:companies_company_add"))
        self.assertEqual(add_page.status_code, 403)
