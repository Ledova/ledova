from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from users.constants import ACCOUNT_STATUS_SUSPENDED
from users.models import InvestorClassificationStatus, UserAccount
from users.services import transition_classification
from wallets.models import Wallet
from whitelist.models import (
    WhitelistAction,
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistStatus,
)
from whitelist.services import changes, refresh, whitelist
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    WhitelistNode,
    a_verified_claim,
    admitted_signer,
    change_actor,
    change_company,
    change_entry,
    change_investor,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class ClassificationRefreshTest(TransactionTestCase):
    def setUp(self):
        self.actor = change_actor()
        self.account = change_investor()
        self.entry = change_entry(self.account)
        self.company = change_company()
        self.node = WhitelistNode()
        admitted_signer()
        for module in (changes, whitelist):
            patcher = patch.object(module, "get_base_chain_client", return_value=self.node.client)
            patcher.start()
            self.addCleanup(patcher.stop)

    def approval(self):
        return WhitelistApproval.objects.select_related("entry__wallet", "company").get(
            entry=self.entry, company=self.company
        )

    def approve(self, expires_at=None):
        return changes.submit(
            uuid4(), WhitelistAction.ADD, ADDRESS, self.actor, company=self.company, expires_at=expires_at
        )

    def claim(self, days=365, reviewed_by=None):
        return a_verified_claim(
            self.account, timezone.now() + timedelta(days=days), reviewed_by=reviewed_by or self.actor
        )

    def sent(self):
        return len(self.node.broadcasts)

    def test_a_revoked_claim_removes_the_approval_and_a_second_refresh_submits_nothing(self):
        claim = self.claim()
        self.approve(expires_at=claim.expires_at)
        self.assertEqual(self.node.expiries[ADDRESS], int(claim.expires_at.replace(microsecond=0).timestamp()))
        claim.revoke(self.actor, "no longer holds")

        change = refresh.refresh_approval(self.approval(), self.actor)

        self.assertEqual((change.action, change.status), ("remove", WhitelistChangeStatus.CONFIRMED))
        self.assertEqual(change.authority, WhitelistAuthority.CLASSIFICATION_REFRESH)
        self.assertEqual(self.node.expiries[ADDRESS], 0)
        self.assertEqual(self.approval().status, WhitelistStatus.REMOVED)
        sent = self.sent()
        self.assertIsNone(refresh.refresh_approval(self.approval(), self.actor))
        self.assertEqual(self.sent(), sent)

    def test_a_renewed_claim_extends_the_recorded_expiry_without_staff(self):
        first = self.claim(days=30)
        self.approve(expires_at=first.expires_at)
        renewed = self.claim(days=400)

        change = refresh.refresh_approval(self.approval(), self.actor)

        expected = int(renewed.expires_at.replace(microsecond=0).timestamp())
        self.assertEqual((change.action, change.status), ("add", WhitelistChangeStatus.CONFIRMED))
        self.assertEqual(self.node.expiries[ADDRESS], expected)
        self.assertEqual(self.approval().expires_at, renewed.expires_at.replace(microsecond=0))
        self.assertIsNone(refresh.refresh_approval(self.approval(), self.actor))

    def test_an_ordinary_expiry_needs_no_write_at_all(self):
        claim = self.claim(days=30)
        self.approve(expires_at=claim.expires_at)
        lapsed = timezone.now() - timedelta(days=1)
        self.node.expiries[ADDRESS] = int(lapsed.timestamp())
        WhitelistApproval.objects.filter(pk=self.approval().pk).update(expires_at=lapsed)
        type(claim).objects.filter(pk=claim.pk).update(expires_at=lapsed)
        sent = self.sent()

        self.assertIsNone(refresh.refresh_approval(self.approval(), self.actor))
        self.assertEqual(self.sent(), sent)
        self.assertEqual(WhitelistChange.objects.filter(authority=WhitelistAuthority.CLASSIFICATION_REFRESH).count(), 0)

    def test_an_expiry_that_lapsed_while_the_refresh_ran_removes_instead_of_setting_a_past_expiry(self):
        self.claim(days=30)
        self.approve(expires_at=timezone.now() + timedelta(days=90))
        lapsed = int((timezone.now() - timedelta(seconds=1)).timestamp())

        with patch.object(refresh, "wanted_expiry", return_value=lapsed):
            change = refresh.refresh_approval(self.approval(), self.actor)

        self.assertEqual((change.action, change.status), ("remove", WhitelistChangeStatus.CONFIRMED))
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_an_entry_with_no_investor_account_keeps_the_expiry_staff_entered(self):
        chosen = timezone.now() + timedelta(days=900)
        self.approve(expires_at=chosen)
        UserAccount.objects.filter(pk=self.account.pk).update(role="issuer")
        sent = self.sent()

        self.assertIs(refresh.wanted_expiry(self.approval()), refresh.STAFF_ENTERED)
        self.assertIsNone(refresh.refresh_approval(self.approval(), self.actor))
        self.assertEqual(self.sent(), sent)
        self.assertEqual(self.approval().expires_at, chosen.replace(microsecond=0))

    def test_an_account_no_longer_in_good_standing_is_removed(self):
        claim = self.claim()
        self.approve(expires_at=claim.expires_at)
        UserAccount.objects.filter(pk=self.account.pk).update(account_status=ACCOUNT_STATUS_SUSPENDED)

        change = refresh.refresh_approval(self.approval(), self.actor)

        self.assertEqual((change.action, change.status), ("remove", WhitelistChangeStatus.CONFIRMED))
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_a_failed_removal_reads_as_not_approved_and_is_resubmitted(self):
        claim = self.claim()
        self.approve(expires_at=claim.expires_at)
        claim.revoke(self.actor, "no longer holds")
        self.node.receipt_status = 0

        failed = refresh.refresh_approval(self.approval(), self.actor)

        self.assertEqual(failed.status, WhitelistChangeStatus.FAILED)
        self.assertEqual(self.approval().status, WhitelistStatus.FAILED)
        self.assertFalse(self.approval().is_listed())
        self.assertFalse(WhitelistApproval.objects.live().filter(pk=self.approval().pk).exists())
        self.assertFalse(whitelist.approved_for_any_company(ADDRESS))
        self.assertTrue(WhitelistApproval.objects.to_sync().filter(pk=self.approval().pk).exists())
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)

        self.node.receipt_status = 1
        resubmitted = refresh.refresh_approval(self.approval(), self.actor)

        self.assertNotEqual(resubmitted.pk, failed.pk)
        self.assertEqual(resubmitted.status, WhitelistChangeStatus.CONFIRMED)
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_the_sweep_submits_under_the_staff_member_whose_review_decided_it(self):
        reviewer = get_user_model().objects.create_user(
            email="reviewer@example.test", password="synthetic", is_staff=True, is_active=True
        )
        claim = self.claim(reviewed_by=reviewer)
        self.approve(expires_at=claim.expires_at)
        claim.revoke(reviewer, "no longer holds")

        self.assertEqual(refresh.sweep(), {"checked": 1, "submitted": 1, "unattributed": 0, "errors": 0})

        change = WhitelistChange.objects.get(authority=WhitelistAuthority.CLASSIFICATION_REFRESH)
        self.assertEqual((change.action, change.initiated_by_id), ("remove", reviewer.pk))
        self.assertEqual(self.node.expiries[ADDRESS], 0)
        self.assertEqual(refresh.sweep()["submitted"], 0)

    def test_the_sweep_lists_a_row_no_actor_explains_rather_than_writing_it(self):
        claim = self.claim()
        self.approve(expires_at=claim.expires_at)
        UserAccount.objects.filter(pk=self.account.pk).update(account_status=ACCOUNT_STATUS_SUSPENDED)
        sent = self.sent()

        self.assertEqual(refresh.sweep(), {"checked": 1, "submitted": 0, "unattributed": 1, "errors": 0})
        self.assertEqual(self.sent(), sent)
        self.assertEqual(WhitelistChange.objects.filter(authority=WhitelistAuthority.CLASSIFICATION_REFRESH).count(), 0)

    def test_a_holder_can_only_remove_through_the_refresh_authority(self):
        holder = self.account.user_profile.user
        with self.assertRaises(PermissionDenied):
            changes.submit(
                uuid4(),
                WhitelistAction.ADD,
                ADDRESS,
                holder,
                company=self.company,
                authority=WhitelistAuthority.CLASSIFICATION_REFRESH,
            )
        self.assertFalse(WhitelistChange.objects.exists())

        self.claim()
        self.approve()
        change = changes.submit(
            uuid4(),
            WhitelistAction.REMOVE,
            ADDRESS,
            holder,
            company=self.company,
            authority=WhitelistAuthority.CLASSIFICATION_REFRESH,
        )
        self.assertEqual((change.status, change.initiated_by_id), (WhitelistChangeStatus.CONFIRMED, holder.pk))

    def test_a_deleted_wallet_has_its_company_approvals_removed(self):
        self.claim()
        self.approve()
        holder = self.account.user_profile.user
        targets = refresh.targets_for_wallet(self.entry.wallet_id)
        Wallet.objects.filter(pk=self.entry.wallet_id).delete()
        self.assertFalse(WhitelistApproval.objects.exists())

        self.assertEqual(refresh.refresh_targets(targets, holder), {"checked": 1, "submitted": 1, "errors": 0})

        self.assertEqual(self.node.expiries[ADDRESS], 0)
        self.assertEqual(refresh.refresh_targets(targets, holder)["submitted"], 0)

    def test_a_wallet_deletion_removes_even_while_its_approval_still_stands(self):
        self.claim()
        self.approve()
        holder = self.account.user_profile.user
        targets = refresh.targets_for_wallet(self.entry.wallet_id)

        self.assertEqual(
            refresh.refresh_targets(targets, holder, remove_only=True),
            {"checked": 1, "submitted": 1, "errors": 0},
        )

        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_revoking_a_claim_enqueues_the_refresh_for_the_reviewer(self):
        self.claim()
        self.approve()
        claim = self.account.investor_classifications.filter(status=InvestorClassificationStatus.VERIFIED).get()
        with patch("whitelist.tasks.refresh.refresh_whitelist_targets.defer") as defer:
            transition_classification(claim, "revoke", reviewed_by=self.actor, reason="no longer holds")

        defer.assert_called_once_with(
            targets=[
                {
                    "address": ADDRESS,
                    "company": str(self.company.pk),
                    "registry": self.approval().registry_address,
                }
            ],
            actor_id=str(self.actor.pk),
            remove_only=False,
        )
