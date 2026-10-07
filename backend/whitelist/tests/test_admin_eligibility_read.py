import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from operators.services import worklist
from shared.db import use_migrate, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import InvestorCategory, InvestorClassificationStatus, UserAccount
from users.services import lifecycle
from users.tests.factories import (
    attach_evidence,
    make_investor,
    verified_classification,
)
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from wallets.models import Wallet
from whitelist.models import WhitelistApproval, WhitelistEntry, WhitelistStatus

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


class WhitelistAdminEligibilityReadTest(
    CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.admin = User.objects.create_superuser(email="wl-admin@example.test", password="pw-12345678")
        self.changelist = reverse("admin:whitelist_whitelistentry_changelist")
        self.add_url = reverse("admin:whitelist_whitelistentry_add")

    def _entry(self, address, *, account=None):
        with use_operator():
            wallet = Wallet.objects.create(user_account=account or self.account, address=address, chain="base")
            return WhitelistEntry.objects.create(wallet=wallet)

    def _historical_technical_approval(self, entry, company):
        with use_migrate():
            return WhitelistApproval.objects.create(
                entry=entry, company=company, registry_address="0x" + "b" * 40, status=WhitelistStatus.ACTIVE
            )

    def _admin_login(self):
        with use_operator():
            self.client.force_authenticate(user=None)
            self.client.force_login(self.admin)

    def test_the_changelist_names_the_absence_of_a_company_approval(self):
        self._entry("0x" + "1" * 40)
        self._admin_login()

        with patch.object(self.source.evidence_file.storage, "open") as private_open:
            response = self.client.get(self.changelist)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertContains(response, "No company approval")
        private_open.assert_not_called()

    def test_the_changelist_shows_exact_company_decision_metadata_without_opening_private_evidence(self):
        request, decision = self.accepted()
        foreign, _ = self.company_fixture("Foreign Diagnostics Pty Ltd", "004085616")
        entry = self._entry("0x" + "2" * 40)
        self._historical_technical_approval(entry, self.company)
        self._historical_technical_approval(entry, foreign)
        self._admin_login()

        with patch.object(self.source.evidence_file.storage, "open") as private_open:
            response = self.client.get(self.changelist)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertContains(response, f"{self.company.name}: current company decision; new actions recheck evidence")
        self.assertContains(response, f"{foreign.name}: no current company decision")
        self.assertEqual(request.company_id, self.company.pk)
        self.assertEqual(decision.appointment_id, self.appointment.pk)
        self.assertEqual(decision.decided_by_id, self.approver.pk)
        private_open.assert_not_called()

    def test_adding_a_wallet_warns_that_technical_whitelisting_never_grants_company_eligibility(self):
        self.accepted()
        self._admin_login()
        for account, address in ((self.account, "0x" + "3" * 40), (self.other_account, "0x" + "4" * 40)):
            with self.subTest(account=account.pk):
                with use_operator():
                    Wallet.objects.create(user_account=account, address=address, chain="base")
                with patch.object(self.source.evidence_file.storage, "open") as private_open:
                    response = self.client.post(
                        self.add_url, {"wallet_address": address, "label": "", "notes": ""}, follow=True
                    )
                self.assertEqual(response.status_code, 200, response.content)
                self.assertContains(response, "Whitelisting the address does not make its holder eligible.")
                with use_operator():
                    entry = WhitelistEntry.objects.filter_by_address(address).get()
                    self.assertFalse(entry.approvals.exists())
                private_open.assert_not_called()

    def test_a_current_company_decision_on_another_account_does_not_mark_this_wallet_current(self):
        self.accepted()
        entry = self._entry("0x" + "5" * 40, account=self.other_account)
        self._historical_technical_approval(entry, self.company)
        self._admin_login()

        with patch.object(self.source.evidence_file.storage, "open") as private_open:
            response = self.client.get(self.changelist)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertContains(response, f"{self.company.name}: no current company decision")
        self.assertNotContains(response, "current company decision; new actions recheck evidence")
        private_open.assert_not_called()

    def test_a_primary_associated_person_decision_does_not_mark_secondary_company_eligibility_current(self):
        self.replace_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(self.company.pk))
        self.accepted()
        entry = self._entry("0x" + "6" * 40)
        self._historical_technical_approval(entry, self.company)
        self._admin_login()

        with patch.object(self.source.evidence_file.storage, "open") as private_open:
            response = self.client.get(self.changelist)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertContains(response, f"{self.company.name}: no current company decision")
        private_open.assert_not_called()


@override_settings(STORAGES=TEST_STORAGES)
class WhitelistStandingReviewTest(TestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name))
        self.admin = User.objects.create_superuser(email="standing-admin@example.test", password="pw-12345678")
        Operator.get()
        with use_migrate():
            self.company = Company.objects.create(owner=self.admin, name="First", acn="123123123")
            self.other_company = Company.objects.create(owner=self.admin, name="Second", acn="321321321")
        self.holder, self.account = make_investor("standing-holder")
        self.legacy_source = attach_evidence(verified_classification(self.account, self.admin))
        self.wallet = Wallet.objects.create(user_account=self.account, address="0x" + "a" * 40, chain="base")
        self.entry = WhitelistEntry.objects.create(wallet=self.wallet)
        with use_migrate():
            self.approval = WhitelistApproval.objects.create(
                entry=self.entry, company=self.company, registry_address="0x" + "b" * 40, status=WhitelistStatus.ACTIVE
            )
        self.client.force_login(self.admin)
        self.queue_url = reverse("admin:whitelist_whitelistentry_changelist") + "?holder_standing_review=yes"

    def _delete_account(self, user):
        with use_operator(), _requester_principal(user.pk):
            lifecycle.delete_account(user)

    def _queue(self):
        return WhitelistEntry.objects.needing_standing_review()

    def _approve(self, entry, company):
        with use_migrate():
            return WhitelistApproval.objects.create(
                entry=entry, company=company, registry_address="0x" + "c" * 40, status=WhitelistStatus.ACTIVE
            )

    def test_self_deletion_retains_evidence_and_surfaces_only_the_affected_investor_entry(self):
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
        self._delete_account(company_user)
        evidence_name = self.legacy_source.evidence_file.name

        self._delete_account(self.holder)

        self.account.refresh_from_db()
        self.legacy_source.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual(self.account.account_status, "active")
        self.assertEqual(self.legacy_source.status, InvestorClassificationStatus.VERIFIED)
        self.assertEqual(self.legacy_source.evidence_file.name, evidence_name)
        self.assertTrue(self.legacy_source.evidence_file.storage.exists(evidence_name))
        with self.legacy_source.evidence_file.open("rb") as retained_evidence:
            self.assertEqual(retained_evidence.read(), b"evidence bytes")
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

    def test_review_filter_preserves_admin_view_and_mutation_permissions(self):
        self._delete_account(self.holder)
        viewer = User.objects.create_user(
            email="standing-viewer@example.test", password="pw-12345678", is_staff=True, is_active=True
        )
        self.client.force_login(viewer)
        self.assertEqual(self.client.get(self.queue_url).status_code, 403)
        viewer.user_permissions.add(Permission.objects.get(codename="view_whitelistentry"))
        response = self.client.get(self.queue_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.context["cl"].queryset), {self.entry})
        removal = f"/admin/whitelist/whitelistentry/{self.entry.pk}/remove-from-blockchain/"
        self.assertIn(self.client.post(removal).status_code, (302, 404))
        account_change = reverse("admin:users_useraccount_change", args=[self.account.pk])
        self.assertEqual(self.client.post(account_change, {"account_status": "terminated"}).status_code, 403)
        self.account.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual(self.account.account_status, "active")
        self.assertEqual(self.approval.status, WhitelistStatus.ACTIVE)


class ScopedWhitelistAdminEligibilityReadTest(RunsOnTheScopedConnection, WhitelistAdminEligibilityReadTest):
    pass
