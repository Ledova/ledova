from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from companies.models import Company
from operators.services import worklist
from shared.tests.tenants import a_profile
from users.models import InvestorCategory, InvestorClassificationStatus, UserAccount
from users.models.user_account import AccountRole
from users.services import lifecycle
from users.services.eligibility import account_eligibility
from users.tests.factories import (
    attach_evidence,
    make_investor,
    verified_classification,
)
from wallets.models import Wallet
from whitelist.models import WhitelistApproval, WhitelistEntry, WhitelistStatus

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=TEST_STORAGES)
class WhitelistAdminEligibilityReadTest(TestCase):

    def setUp(self):
        self.admin = User.objects.create_superuser(email="wl-admin@example.test", password="pw-12345678")
        self.reviewer = User.objects.create_user(email="wl-reviewer@example.test", password="pw-12345678")
        self.client.force_login(self.admin)
        self.changelist = reverse("admin:whitelist_whitelistentry_changelist")
        self.add_url = reverse("admin:whitelist_whitelistentry_add")

    def _entry(self, label, address):
        _, account = make_investor(label)
        wallet = Wallet.objects.create(user_account=account, address=address, chain="base")
        return account, WhitelistEntry.objects.create(wallet=wallet)

    def test_the_changelist_names_the_reason_an_account_is_not_eligible(self):
        self._entry("wl-ineligible", "0x" + "1" * 40)

        response = self.client.get(self.changelist)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "no_live_classification")

    def test_the_changelist_marks_an_eligible_account(self):
        account, _ = self._entry("wl-eligible", "0x" + "2" * 40)
        verified_classification(account, self.reviewer)

        response = self.client.get(self.changelist)

        self.assertContains(response, "Eligible")
        self.assertNotContains(response, "no_live_classification")

    def test_adding_an_ineligible_wallet_still_succeeds_and_warns(self):
        _, account = make_investor("wl-add")
        Wallet.objects.create(user_account=account, address="0x" + "3" * 40, chain="base")
        address = "0x" + "3" * 40

        response = self.client.post(self.add_url, {"wallet_address": address, "label": "", "notes": ""}, follow=True)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(WhitelistEntry.objects.filter_by_address(address).exists())
        self.assertContains(response, "not an eligible wholesale investor")

    def test_adding_an_eligible_wallet_raises_no_warning(self):
        _, account = make_investor("wl-add-ok")
        Wallet.objects.create(user_account=account, address="0x" + "4" * 40, chain="base")
        verified_classification(account, self.reviewer)

        response = self.client.post(
            self.add_url, {"wallet_address": "0x" + "4" * 40, "label": "", "notes": ""}, follow=True
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "not an eligible wholesale investor")

    def test_a_wallet_on_an_unqualified_account_is_not_marked_eligible(self):
        _, qualified = make_investor("wl-qualified")
        unqualified = UserAccount.objects.create(
            account_number="ACC-WL-SECOND",
            account_status="active",
            role=AccountRole.INVESTOR,
            user_profile=a_profile("wl-unqualified"),
        )
        verified_classification(qualified, self.reviewer)
        Wallet.objects.create(user_account=unqualified, address="0x" + "5" * 40, chain="base")
        WhitelistEntry.objects.create(wallet=Wallet.objects.get(address="0x" + "5" * 40))

        response = self.client.get(self.changelist)

        self.assertContains(response, "no_live_classification")


@override_settings(STORAGES=TEST_STORAGES)
class WhitelistStandingReviewTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(email="standing-admin@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=self.admin, name="First", acn="123123123")
        self.other_company = Company.objects.create(owner=self.admin, name="Second", acn="321321321")
        self.holder, self.account = make_investor("standing-holder")
        self.claim = attach_evidence(verified_classification(self.account, self.admin))
        self.wallet = Wallet.objects.create(user_account=self.account, address="0x" + "a" * 40, chain="base")
        self.entry = WhitelistEntry.objects.create(wallet=self.wallet)
        self.approval = WhitelistApproval.objects.create(
            entry=self.entry, company=self.company, registry_address="0x" + "b" * 40, status=WhitelistStatus.ACTIVE
        )
        self.client.force_login(self.admin)
        self.queue_url = reverse("admin:whitelist_whitelistentry_changelist") + "?holder_standing_review=yes"

    def _queue(self):
        return WhitelistEntry.objects.needing_standing_review()

    def _approve(self, entry, company):
        return WhitelistApproval.objects.create(
            entry=entry, company=company, registry_address="0x" + "c" * 40, status=WhitelistStatus.ACTIVE
        )

    def test_self_deletion_retains_evidence_and_surfaces_only_the_affected_investor_entry(self):
        self.assertTrue(account_eligibility(self.account, self.company).is_eligible)
        self.assertTrue(self.approval.is_listed())
        self.assertFalse(self._queue().exists())
        self._approve(self.entry, self.other_company)
        _, other_account = make_investor("standing-other")
        other_wallet = Wallet.objects.create(user_account=other_account, address="0x" + "d" * 40, chain="base")
        self._approve(WhitelistEntry.objects.create(wallet=other_wallet), self.other_company)
        treasury = WhitelistEntry.objects.create(address="0x" + "e" * 40, label="Treasury")
        self._approve(treasury, self.company)
        company_user, company_account = make_investor("standing-company", role="company")
        company_wallet = Wallet.objects.create(user_account=company_account, address="0x" + "f" * 40, chain="base")
        self._approve(WhitelistEntry.objects.create(wallet=company_wallet), self.company)
        lifecycle.delete_account(company_user)
        evidence_name = self.claim.evidence_file.name

        lifecycle.delete_account(self.holder)

        self.account.refresh_from_db()
        self.claim.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual(self.account.account_status, "active")
        self.assertEqual(self.claim.status, InvestorClassificationStatus.VERIFIED)
        self.assertEqual(self.claim.evidence_file.name, evidence_name)
        self.assertTrue(self.claim.evidence_file.storage.exists(evidence_name))
        self.assertTrue(account_eligibility(self.account, self.company).is_eligible)
        self.assertTrue(self.approval.is_listed())
        with patch("whitelist.services.refresh.observed_expiry") as chain_read:
            rows = [row for row in worklist() if row.url == self.queue_url]
            response = self.client.get(self.queue_url)
        chain_read.assert_not_called()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].count, 1)
        self.assertEqual(set(response.context["cl"].queryset), {self.entry})
        self.assertContains(response, "Inactive login")
        self.assertContains(response, reverse("admin:users_useraccount_change", args=[self.account.pk]))
        self.assertContains(response, "First: Active")
        self.assertContains(response, "Second: Active")

    def test_removed_and_expired_approvals_stay_in_review_until_the_investment_standing_resolves(self):
        lifecycle.delete_account(self.holder)
        for status, expiry in (
            (WhitelistStatus.REMOVED, None),
            (WhitelistStatus.ACTIVE, timezone.now() - timedelta(days=1)),
        ):
            with self.subTest(status=status):
                WhitelistApproval.objects.filter(pk=self.approval.pk).update(status=status, expires_at=expiry)
                self.assertEqual(set(self._queue()), {self.entry})
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
                self.assertFalse(self._queue().exists())
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")
        self.claim.revoke(reviewed_by=self.admin, reason="Standing review resolved")
        self.assertFalse(self._queue().exists())

    def test_refused_standing_needs_review_until_no_live_or_uncertain_approval_remains(self):
        for standing in ("rejected", "suspended", "terminated"):
            for status in (WhitelistStatus.ACTIVE, WhitelistStatus.PENDING, WhitelistStatus.FAILED):
                with self.subTest(standing=standing, status=status):
                    UserAccount.objects.filter(pk=self.account.pk).update(account_status=standing)
                    WhitelistApproval.objects.filter(pk=self.approval.pk).update(status=status, expires_at=None)
                    self.assertEqual(set(self._queue()), {self.entry})
            WhitelistApproval.objects.filter(pk=self.approval.pk).update(status=WhitelistStatus.REMOVED)
            self.assertFalse(self._queue().exists())
            WhitelistApproval.objects.filter(pk=self.approval.pk).update(
                status=WhitelistStatus.ACTIVE, expires_at=timezone.now() - timedelta(days=1)
            )
            self.assertFalse(self._queue().exists())

    def test_another_companys_classification_does_not_keep_a_removed_approval_in_review(self):
        self.claim.revoke(reviewed_by=self.admin, reason="Company-specific replacement")
        verified_classification(
            self.account, self.admin, category=InvestorCategory.ASSOCIATED_PERSON, company=self.other_company
        )
        WhitelistApproval.objects.filter(pk=self.approval.pk).update(status=WhitelistStatus.REMOVED)
        lifecycle.delete_account(self.holder)

        self.assertFalse(self._queue().exists())

        other_approval = self._approve(self.entry, self.other_company)
        WhitelistApproval.objects.filter(pk=other_approval.pk).update(status=WhitelistStatus.REMOVED)
        self.assertEqual(set(self._queue()), {self.entry})

    def test_review_filter_preserves_admin_view_and_mutation_permissions(self):
        lifecycle.delete_account(self.holder)
        viewer = User.objects.create_user(email="standing-viewer@example.test", password="pw-12345678", is_staff=True)
        self.client.force_login(viewer)
        self.assertEqual(self.client.get(self.queue_url).status_code, 403)
        viewer.user_permissions.add(Permission.objects.get(codename="view_whitelistentry"))
        response = self.client.get(self.queue_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.context["cl"].queryset), {self.entry})
        removal = reverse("admin:whitelist_whitelistentry_remove_from_blockchain", args=[self.entry.pk])
        self.assertEqual(self.client.post(removal).status_code, 403)
        account_change = reverse("admin:users_useraccount_change", args=[self.account.pk])
        self.assertEqual(self.client.post(account_change, {"account_status": "terminated"}).status_code, 403)
        self.account.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual(self.account.account_status, "active")
        self.assertEqual(self.approval.status, WhitelistStatus.ACTIVE)
