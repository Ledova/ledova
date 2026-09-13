from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from assets.models import Asset
from shared.tests.under_the_policies import what_the_policies_admit_to
from users.models import (
    DeviceToken,
    FavouriteAsset,
    FinancialProfile,
    Notification,
    NotificationPreferences,
    UserAccount,
    UserPreferences,
    UserProfile,
)
from users.views.financial_profile import FinancialProfileViewSet
from users.views.user_account import UserAccountViewSet
from users.views.user_profile import UserProfileViewSet

User = get_user_model()


class UserLiveAuthorizationTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice-user@example.test", password="pw-12345678")
        self.bob = User.objects.create_user(email="bob-user@example.test", password="pw-12345678")
        self.staff = User.objects.create_user(
            email="staff-user@example.test",
            password="pw-12345678",
            is_staff=True,
        )
        self.superuser = User.objects.create_superuser(email="super-user@example.test", password="pw-12345678")
        self.alice_profile = UserProfile.objects.create(user=self.alice, full_name="Alice")
        self.bob_profile = UserProfile.objects.create(user=self.bob, full_name="Bob")
        self.alice_financial = FinancialProfile.objects.create(
            user_profile=self.alice_profile,
            occupation="Alice occupation",
        )
        self.bob_financial = FinancialProfile.objects.create(
            user_profile=self.bob_profile,
            occupation="Bob occupation",
        )
        self.alice_account = UserAccount.objects.create(account_number="ACCOUNT-ALICE", user_profile=self.alice_profile)
        self.bob_account = UserAccount.objects.create(account_number="ACCOUNT-BOB", user_profile=self.bob_profile)
        self.alice_preferences = UserPreferences.objects.create(user_profile=self.alice_profile)
        self.bob_preferences = UserPreferences.objects.create(user_profile=self.bob_profile)
        self.asset = Asset.objects.create(
            symbol="USER-SCOPE",
            name="User scope asset",
            asset_type="tokenized_security",
            is_active=True,
            is_verified=True,
        )
        self.alice_favourite = FavouriteAsset.objects.create(
            user_account=self.alice_account,
            asset=self.asset,
        )
        self.bob_favourite = FavouriteAsset.objects.create(
            user_account=self.bob_account,
            asset=self.asset,
        )

    @staticmethod
    def rows(response):
        body = response.json()
        return body.get("results", body) if isinstance(body, dict) else body

    def test_live_scopes_follow_current_relationships(self):
        cases = (
            (what_the_policies_admit_to(self.alice, UserProfile), self.alice_profile, self.bob_profile),
            (
                what_the_policies_admit_to(self.alice, FinancialProfile),
                self.alice_financial,
                self.bob_financial,
            ),
            (
                what_the_policies_admit_to(self.alice, UserPreferences),
                self.alice_preferences,
                self.bob_preferences,
            ),
            (
                what_the_policies_admit_to(self.alice, FavouriteAsset),
                self.alice_favourite,
                self.bob_favourite,
            ),
        )
        for queryset, own_object, foreign_object in cases:
            with self.subTest(model=queryset.model._meta.label):
                self.assertIn(own_object, queryset)
                self.assertNotIn(foreign_object, queryset)

    def test_profile_reassignment_immediately_updates_profile_and_financial_visibility(self):
        replacement_owner = User.objects.create_user(
            email="replacement-user@example.test",
            password="pw-12345678",
        )

        self.alice_profile.user = replacement_owner
        self.alice_profile.save(update_fields=["user"])

        self.assertNotIn(self.alice_profile, what_the_policies_admit_to(self.alice, UserProfile))
        self.assertNotIn(self.alice_financial, what_the_policies_admit_to(self.alice, FinancialProfile))
        self.assertIn(self.alice_profile, what_the_policies_admit_to(replacement_owner, UserProfile))
        self.assertIn(self.alice_financial, what_the_policies_admit_to(replacement_owner, FinancialProfile))

    def test_profile_email_update_is_rejected_without_mutation(self):
        original_email = self.alice.email
        original_name = self.alice_profile.full_name
        self.client.force_authenticate(self.alice)

        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                f"/api/user-profiles/{self.alice_profile.uuid}/",
                {
                    "email": "replacement@example.test",
                    "fullName": "Updated Alice",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data,
            {"email": ["Email cannot be changed through a profile update."]},
        )
        self.alice.refresh_from_db()
        self.alice_profile.refresh_from_db()
        self.assertEqual(self.alice.email, original_email)
        self.assertEqual(self.alice_profile.full_name, original_name)
        user_table = User._meta.db_table.upper()
        self.assertFalse(
            any(
                query["sql"].lstrip().upper().startswith(f'UPDATE "{user_table}"')
                for query in captured.captured_queries
            )
        )

    def test_update_actions_request_database_row_locks(self):
        for action in ("update", "partial_update"):
            cases = (
                (UserProfileViewSet, self.staff, ("self",)),
                (FinancialProfileViewSet, self.staff, ()),
                (UserAccountViewSet, self.alice, ()),
            )
            for view_class, user, expected_of in cases:
                view = view_class()
                view.request = SimpleNamespace(user=user)
                view.action = action

                queryset = view.get_queryset()

                with self.subTest(action=action, view=view_class.__name__):
                    self.assertTrue(queryset.query.select_for_update)
                    self.assertEqual(queryset.query.select_for_update_of, expected_of)

    def test_favourite_filters_cannot_expand_the_live_scope(self):
        self.client.force_authenticate(self.alice)

        response = self.client.get(
            "/api/favourite-assets/",
            {"user_account": str(self.bob_account.uuid)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.rows(response), [])

    def test_anonymous_managers_fail_closed(self):
        anonymous = AnonymousUser()
        managers = (
            UserProfile.objects,
            UserAccount.objects,
            FinancialProfile.objects,
            UserPreferences.objects,
            FavouriteAsset.objects,
            Notification.objects,
            NotificationPreferences.objects,
            DeviceToken.objects,
        )
        seen = [
            manager.model._meta.label
            for manager in managers
            for caller in (anonymous, None)
            if what_the_policies_admit_to(caller, manager.model).exists()
        ]

        self.assertEqual(seen, [])
