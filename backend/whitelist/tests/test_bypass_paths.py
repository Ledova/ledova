from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.contrib.messages.storage.fallback import FallbackStorage
from django.db import DatabaseError, IntegrityError, connections
from django.test import RequestFactory, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from offerings.admin.subscription import SubscriptionAdmin
from offerings.models import Subscription
from shared.db import current_alias
from whitelist.admin import WhitelistEntryAdmin
from whitelist.models import (
    WhitelistAction,
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistEntry,
    WhitelistStatus,
)
from whitelist.services import changes, whitelist
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    REGISTRY,
    WhitelistNode,
    change_company,
    change_entry,
)
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases

CHAIN_ACTIONS = {"add_to_blockchain", "remove_from_blockchain"}


def a_staff_member(label, *codenames, model=WhitelistEntry):
    user = get_user_model().objects.create_user(
        email=f"{label}@example.test", password="synthetic", is_staff=True, is_active=True
    )
    user.user_permissions.add(
        *Permission.objects.filter(content_type=ContentType.objects.get_for_model(model), codename__in=codenames)
    )
    return get_user_model().objects.get(pk=user.pk)


def a_request(user):
    request = RequestFactory().post("/admin/")
    request.user = user
    request.session = {}
    request._messages = FallbackStorage(request)
    return request


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class WhitelistAuthorityBypassTest(CompanyWalletCases, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.actor = self.owner
        self.entry = WhitelistEntry.objects.create(wallet=self.wallet)

    def submit(self, action, actor, **options):
        return changes.submit(uuid4(), action, ADDRESS, actor, company=self.company, **options)

    def test_an_authority_outside_the_four_entry_points_never_reaches_the_chain(self):
        with self.assertRaises(PermissionDenied):
            self.submit(WhitelistAction.ADD, self.actor, authority="board_resolution")

        self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_the_database_refuses_fresh_unsigned_staff_admission_independently_of_the_service(self):
        with self.actual_operator(), self.assertRaises(IntegrityError):
            WhitelistChange.objects.create(
                action="add",
                address=ADDRESS,
                chain_id=CHAIN_ID,
                registry_address=REGISTRY,
                company=self.company,
                intent=changes._intent("add", ADDRESS, REGISTRY, None),
                authority="operator_api",
                initiated_by=self.actor,
            )
        self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_the_database_refuses_moving_an_admitted_change_to_another_authority(self):
        proposal, _ = self.applied_wallet()
        change = self.execute(proposal)
        self.assertEqual(change.authority, WhitelistAuthority.COMPANY)

        with self.assertRaises(DatabaseError):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "UPDATE whitelist_whitelistchange SET authority = %s WHERE uuid = %s",
                    [WhitelistAuthority.SUBSCRIPTION_ADMIN, str(change.pk)],
                )

        self.assertEqual(WhitelistChange.objects.get(pk=change.pk).authority, WhitelistAuthority.COMPANY)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class WhitelistAdminActionAuthorityTest(TransactionTestCase):
    def setUp(self):
        self.entry = change_entry()
        self.company = change_company()
        self.admin = WhitelistEntryAdmin(WhitelistEntry, AdminSite())
        self.node = WhitelistNode()
        patcher = patch.object(whitelist, "get_base_chain_client", return_value=self.node.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def actions_for(self, user):
        return set(self.admin.get_actions(a_request(user)))

    def test_the_chain_actions_are_withheld_from_staff_without_the_change_permission(self):
        viewer = a_staff_member("whitelist-viewer", "view_whitelistentry")
        editor = a_staff_member("whitelist-editor", "view_whitelistentry", "change_whitelistentry")

        self.assertEqual(self.actions_for(viewer) & CHAIN_ACTIONS, set())
        self.assertEqual(self.actions_for(editor) & CHAIN_ACTIONS, set())

    def test_the_sync_action_copies_the_chain_and_grants_no_approval(self):
        viewer = a_staff_member("whitelist-syncer", "view_whitelistentry")
        WhitelistApproval.objects.create(
            entry=self.entry,
            company=self.company,
            registry_address=REGISTRY.lower(),
            status=WhitelistStatus.ACTIVE,
            expires_at=timezone.now() + timedelta(days=30),
        )

        self.assertIn("sync_with_blockchain", self.actions_for(viewer))
        self.admin.sync_with_blockchain(a_request(viewer), WhitelistEntry.objects.filter(pk=self.entry.pk))

        approval = WhitelistApproval.objects.get(entry=self.entry, company=self.company)
        self.assertEqual(approval.status, WhitelistStatus.REMOVED)
        self.assertIsNone(approval.expires_at)
        self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_the_subscription_action_is_withheld_from_staff_without_the_change_permission(self):
        admin = SubscriptionAdmin(Subscription, AdminSite())
        viewer = a_staff_member("subscription-viewer", "view_subscription", model=Subscription)
        editor = a_staff_member("subscription-editor", "view_subscription", "change_subscription", model=Subscription)

        self.assertNotIn("whitelist_wallets", set(admin.get_actions(a_request(viewer))))
        self.assertNotIn("whitelist_wallets", set(admin.get_actions(a_request(editor))))
