from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from users.models import UserAccount, UserProfile
from users.models.user_account import AccountRole
from users.serializers.user_account import ROLE_IS_SET

User = get_user_model()


class TheRoleIsChosenAtSignUpTest(APITestCase):

    def setUp(self):
        self.user = User.objects.create_user(email="role@example.test", password="pw-12345678", is_active=True)
        self.profile = UserProfile.objects.create(user=self.user)
        self.account = UserAccount.objects.create(account_number="ACC-ROLE", user_profile=self.profile)
        self.client.force_authenticate(self.user)
        self.url = reverse("user-accounts-detail", args=[self.account.uuid])

    def complete_sign_up(self):
        self.profile.is_signup_completed = True
        self.profile.save(update_fields=["is_signup_completed"])

    def test_the_account_type_step_can_switch_the_role_before_sign_up_is_complete(self):
        for role in (AccountRole.COMPANY, AccountRole.INVESTOR):
            with self.subTest(role=role):
                response = self.client.patch(self.url, {"role": role}, format="json")

                self.assertEqual(response.status_code, 200, response.content)
                self.account.refresh_from_db()
                self.assertEqual(self.account.role, role)

    def test_a_customer_cannot_change_the_role_once_sign_up_is_complete(self):
        self.complete_sign_up()

        for role in (AccountRole.COMPANY, AccountRole.BOTH):
            with self.subTest(role=role):
                response = self.client.patch(self.url, {"role": role}, format="json")

                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json(), {"role": [ROLE_IS_SET]})
        self.account.refresh_from_db()
        self.assertEqual(self.account.role, AccountRole.INVESTOR)

    def test_sending_the_role_already_held_after_sign_up_is_not_a_change(self):
        self.complete_sign_up()

        response = self.client.patch(self.url, {"role": AccountRole.INVESTOR}, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["role"], AccountRole.INVESTOR)


class StaffSetTheRoleInAdminTest(TestCase):

    def test_staff_can_set_both_after_sign_up_is_complete(self):
        self.client.force_login(User.objects.create_superuser(email="staff@example.test", password="pw-12345678"))
        user = User.objects.create_user(email="both@example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user, is_signup_completed=True)
        account = UserAccount.objects.create(account_number="ACC-BOTH", user_profile=profile)

        response = self.client.post(
            reverse("admin:users_useraccount_change", args=[account.pk]),
            {
                "user_profile": profile.pk,
                "account_number": account.account_number,
                "account_type": account.account_type,
                "account_status": account.account_status,
                "role": AccountRole.BOTH,
                "activation_date_0": "",
                "activation_date_1": "",
                "rejection_reason": "",
            },
        )

        self.assertEqual(response.status_code, 302, getattr(response, "context_data", response))
        account.refresh_from_db()
        self.assertEqual(account.role, AccountRole.BOTH)
