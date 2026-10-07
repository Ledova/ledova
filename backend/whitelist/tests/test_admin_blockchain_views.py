from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import NoReverseMatch, reverse

from shared.tests.tenants import an_account
from wallets.models import Wallet
from whitelist.models import WhitelistApproval, WhitelistEntry
from whitelist.tests.change_fixtures import REGISTRY, change_company

User = get_user_model()


TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=TEST_STORAGES)
class WhitelistAdminBlockchainConfirmViewsTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(email="admin-whitelist@ex.com", password="pw-12345678")
        self.client.force_login(self.admin)
        account = an_account("admin-blockchain-views")
        self.company = change_company("admin-blockchain-views")
        self.entry = WhitelistEntry.objects.create(
            wallet=Wallet.objects.create(user_account=account, address="0x" + "c" * 40, chain="ethereum")
        )
        WhitelistApproval.objects.create(
            entry=self.entry, company=self.company, registry_address=REGISTRY, status="active"
        )

    def test_the_change_page_lists_each_company_approval(self):
        response = self.client.get(reverse("admin:whitelist_whitelistentry_change", args=[self.entry.uuid]))

        self.assertContains(response, self.company.name)
        self.assertContains(response, REGISTRY)
        changelist = self.client.get(reverse("admin:whitelist_whitelistentry_changelist"))
        self.assertContains(changelist, f"{self.company.name}: Active")

    def test_fresh_staff_add_and_remove_confirmations_are_retired(self):
        for action in ("add_to_blockchain", "remove_from_blockchain"):
            with self.subTest(action=action), self.assertRaises(NoReverseMatch):
                reverse(f"admin:whitelist_whitelistentry_{action}", args=[self.entry.pk])
        response = self.client.get(reverse("admin:whitelist_whitelistentry_change", args=[self.entry.pk]))
        self.assertContains(response, "Company appointees")
        self.assertNotContains(response, "Add to blockchain")
        self.assertNotContains(response, "Remove from blockchain")
