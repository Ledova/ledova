from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from shared.tests.tenants import an_account
from wallets.models import Wallet
from whitelist.models import WhitelistApproval, WhitelistEntry, WhitelistStatus
from whitelist.services import whitelist
from whitelist.tests.change_fixtures import REGISTRY, change_company

ADDRESS = "0x" + "c" * 40


class StablecoinPartyApprovedWithAnyCompanyTest(TestCase):
    def setUp(self):
        self.company = change_company("approved-anywhere")
        wallet = Wallet.objects.create(user_account=an_account("approved-anywhere"), address=ADDRESS, chain="base")
        self.entry = WhitelistEntry.objects.create(wallet=wallet)

    def approve(self, **terms):
        return WhitelistApproval.objects.create(
            entry=self.entry, company=self.company, registry_address=REGISTRY, **terms
        )

    def test_an_address_with_no_approval_is_approved_nowhere(self):
        self.assertFalse(whitelist.approved_for_any_company(ADDRESS))

    def test_an_active_approval_without_an_expiry_counts(self):
        self.approve(status=WhitelistStatus.ACTIVE)

        self.assertTrue(whitelist.approved_for_any_company(ADDRESS))

    def test_an_active_approval_counts_until_its_expiry_passes(self):
        approval = self.approve(status=WhitelistStatus.ACTIVE, expires_at=timezone.now() + timedelta(minutes=1))

        self.assertTrue(whitelist.approved_for_any_company(ADDRESS))

        approval.expires_at = timezone.now() - timedelta(seconds=1)
        approval.save()

        self.assertFalse(whitelist.approved_for_any_company(ADDRESS))

    def test_an_approval_that_is_not_active_does_not_count(self):
        for status in (WhitelistStatus.PENDING, WhitelistStatus.FAILED, WhitelistStatus.REMOVED):
            with self.subTest(status=status):
                WhitelistApproval.objects.all().delete()
                self.approve(status=status)

                self.assertFalse(whitelist.approved_for_any_company(ADDRESS))

    def test_another_address_approval_does_not_count(self):
        self.approve(status=WhitelistStatus.ACTIVE)

        self.assertFalse(whitelist.approved_for_any_company("0x" + "d" * 40))
