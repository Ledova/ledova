from datetime import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

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

    def confirm_page(self, name):
        response = self.client.get(reverse(f"admin:whitelist_whitelistentry_{name}", args=[self.entry.uuid]))
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "admin/whitelist/confirm_changes.html")
        self.assertContains(response, self.entry.wallet.address)
        return response

    def confirm(self, name, **fields):
        page = self.confirm_page(name)
        data = {
            "confirm_whitelist": "1",
            "whitelist_confirmation": page.context["whitelist_confirmation"],
            **fields,
        }
        with patch("whitelist.admin_actions.submit") as submit:
            submit.return_value.status = "confirmed"
            response = self.client.post(
                reverse(f"admin:whitelist_whitelistentry_{name}", args=[self.entry.uuid]), data, follow=True
            )
        return response, submit

    def test_add_confirm_page_asks_for_the_company_and_an_optional_expiry(self):
        response = self.confirm_page("add_to_blockchain")

        self.assertContains(response, 'name="whitelist_company"')
        self.assertContains(response, f'<option value="{self.company.pk}">{self.company}</option>', html=True)
        self.assertContains(response, 'name="whitelist_expires_at"')

    def test_remove_confirm_page_asks_for_the_company_and_no_expiry(self):
        response = self.confirm_page("remove_from_blockchain")

        self.assertContains(response, 'name="whitelist_company"')
        self.assertNotContains(response, 'name="whitelist_expires_at"')

    def test_confirming_an_addition_submits_the_chosen_company_and_expiry(self):
        response, submit = self.confirm(
            "add_to_blockchain", whitelist_company=str(self.company.pk), whitelist_expires_at="2099-01-02T03:04"
        )

        self.assertContains(response, "Completed 1 whitelist change(s).")
        options = submit.call_args.kwargs
        self.assertEqual(options["company"], self.company)
        self.assertEqual(options["expires_at"], timezone.make_aware(datetime(2099, 1, 2, 3, 4)))
        self.assertEqual(options["wallet_uuid"], str(self.entry.wallet_id))

    def test_a_blank_expiry_means_none(self):
        _, submit = self.confirm("add_to_blockchain", whitelist_company=str(self.company.pk), whitelist_expires_at="")

        self.assertIsNone(submit.call_args.kwargs["expires_at"])

    def test_a_confirmation_without_a_company_submits_nothing(self):
        for company in ("", "not-a-uuid", "00000000-0000-0000-0000-000000000000"):
            with self.subTest(company=company):
                response, submit = self.confirm("add_to_blockchain", whitelist_company=company)
                self.assertContains(response, "Choose the company this whitelist change is for.")
                submit.assert_not_called()

    def test_an_unreadable_expiry_submits_nothing(self):
        response, submit = self.confirm(
            "add_to_blockchain", whitelist_company=str(self.company.pk), whitelist_expires_at="next tuesday"
        )

        self.assertContains(response, "Enter the expiry as a date and time, or leave it blank.")
        submit.assert_not_called()

    def test_the_change_page_lists_each_company_approval(self):
        response = self.client.get(reverse("admin:whitelist_whitelistentry_change", args=[self.entry.uuid]))

        self.assertContains(response, self.company.name)
        self.assertContains(response, REGISTRY)
        changelist = self.client.get(reverse("admin:whitelist_whitelistentry_changelist"))
        self.assertContains(changelist, f"{self.company.name}: Active")
