from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from users.models import UserAccount, UserProfile

User = get_user_model()


class UserAccountCreateTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="owner@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=self.user, full_name="Owner")
        self.client.force_authenticate(self.user)

    def test_the_requester_is_the_director_whatever_the_payload_names(self):
        other_user = User.objects.create_user(email="other@example.test", password="pw-12345678")
        other_profile = UserProfile.objects.create(user=other_user)

        response = self.client.post(
            "/api/user-accounts/",
            {"accountType": "individual", "director": other_profile.pk},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        account = UserAccount.objects.get(uuid=response.json()["uuid"])
        self.assertEqual(account.director_id, self.profile.pk)
        self.assertEqual(account.user_profile_id, self.profile.pk)
        self.assertEqual(response.json()["director"], str(self.profile.pk))
