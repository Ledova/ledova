from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from users.models import UserAccount, UserProfile
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.serializers.wallet import WalletSerializer

User = get_user_model()


class WalletOwnerScopingTest(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice@ex.com", password="pw-12345678")
        self.bob = User.objects.create_user(email="bob@ex.com", password="pw-12345678")
        self.alice_account = UserAccount.objects.create(user_profile=UserProfile.objects.create(user=self.alice))
        self.bob_account = UserAccount.objects.create(user_profile=UserProfile.objects.create(user=self.bob))

    def _serializer_for(self, user):
        request = APIRequestFactory().post("/api/wallets/")
        request.user = user
        return WalletSerializer(context={"request": request})

    def test_the_owner_field_is_not_writable_at_all(self):
        self.assertTrue(self._serializer_for(self.alice).fields["user_account"].read_only)

    def test_a_named_account_is_ignored_and_the_wallet_lands_on_the_callers(self):
        serializer = WalletSerializer(
            data={
                "user_account": str(self.bob_account.uuid),
                "address": "0x" + "c" * 40,
                "chain": "ethereum",
                "wallet_type": "software",
            },
            context=self._serializer_for(self.alice).context,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["user_account"], self.alice_account)

    def test_verified_wallet_identity_fields_are_immutable(self):
        wallet = Wallet.objects.create(
            user_account=self.alice_account,
            address="0x" + "a" * 40,
            chain="ethereum",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )
        cases = (
            ({"address": "0x" + "d" * 40}, "address"),
            ({"chain": "base"}, "chain"),
        )
        for payload, field in cases:
            with self.subTest(field=field):
                serializer = WalletSerializer(
                    wallet,
                    data=payload,
                    partial=True,
                    context=self._serializer_for(self.alice).context,
                )
                self.assertFalse(serializer.is_valid())
                self.assertIn(field, serializer.errors)


class LiveMembershipScopingTest(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice-membership@ex.com", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=self.alice)
        self.account = UserAccount.objects.create(user_profile=self.profile)
        self.wallet = Wallet.objects.create(
            user_account=self.account,
            address="0x" + "a" * 40,
            chain="ethereum",
        )

    def _serializer_for(self, user):
        request = APIRequestFactory().post("/api/wallets/")
        request.user = user
        return WalletSerializer(context={"request": request})

    def test_staff_and_superuser_account_scope_follows_the_profile_link(self):
        staff = User.objects.create_user(email="staff-membership@ex.com", password="pw-12345678", is_staff=True)
        superuser = User.objects.create_user(
            email="superuser-membership@ex.com",
            password="pw-12345678",
            is_superuser=True,
            is_staff=True,
        )

        for privileged_user in (staff, superuser):
            profile = UserProfile.objects.create(user=privileged_user)
            own_account = UserAccount.objects.create(user_profile=profile)

            with self.subTest(user=privileged_user.email):
                self.assertNotIn(
                    self.account.uuid,
                    UserAccount.objects.visible_to_user(privileged_user).values_list("uuid", flat=True),
                )
                self.assertIn(
                    own_account.uuid,
                    UserAccount.objects.visible_to_user(privileged_user).values_list("uuid", flat=True),
                )
                self.assertTrue(self._serializer_for(privileged_user).fields["user_account"].read_only)
