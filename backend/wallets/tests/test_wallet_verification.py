import json

from django.db import connections
from eth_account import Account
from eth_account.messages import encode_defunct
from rest_framework.test import APITestCase

from shared.db import current_alias, use_operator
from shared.tests.tenants import make_tenant
from wallets.constants import (
    WALLET_VERIFICATION_STATUS_PENDING,
    WALLET_VERIFICATION_STATUS_VERIFIED,
)
from wallets.exceptions import VerificationChallengeNotFoundException
from wallets.models import WalletPossessionProof
from wallets.tasks.sync import sync_wallet


class WalletVerificationTest(APITestCase):
    def setUp(self):
        self.tenant = make_tenant("owner")
        self.wallet = self.tenant.spare_wallet
        self.key = Account.from_key("0x" + "22" * 32)
        self.wallet.address = self.key.address
        self.wallet.save(update_fields=["address"])
        self.client.force_authenticate(self.tenant.user)

    def signature(self, challenge):
        return self.key.sign_message(encode_defunct(text=challenge)).signature.to_0x_hex()

    def queued(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT task_name, args FROM procrastinate_jobs WHERE args->>'wallet_uuid' = %s", [str(self.wallet.pk)]
            )
            return [
                (name, payload if isinstance(payload, dict) else json.loads(payload))
                for name, payload in cursor.fetchall()
            ]

    def test_request_verification_persists_the_challenge_it_returns(self):
        response = self.client.post(f"/api/wallets/{self.wallet.uuid}/request-verification/")

        self.assertEqual(response.status_code, 200)
        self.wallet.refresh_from_db()
        self.assertTrue(self.wallet.verification_challenge)
        self.assertEqual(response.json()["challenge"], self.wallet.verification_challenge)
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_PENDING)

    def test_valid_signature_verifies_wallet_and_enqueues_one_sync(self):
        issued = self.client.post(f"/api/wallets/{self.wallet.uuid}/request-verification/")
        self.assertEqual(issued.status_code, 200)

        signature = self.signature(issued.json()["challenge"])
        response = self.client.post(
            f"/api/wallets/{self.wallet.uuid}/verify-signature/", {"signature": signature}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["verificationStatus"], WALLET_VERIFICATION_STATUS_VERIFIED)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_VERIFIED)
        self.assertEqual(self.wallet.verification_signature, signature)
        self.assertIsNotNone(self.wallet.verified_at)
        with use_operator():
            proof = WalletPossessionProof.objects.get(wallet_id=self.wallet.pk)
        self.assertEqual((proof.challenge, proof.signature), (issued.json()["challenge"], signature))
        self.assertEqual(
            self.queued(),
            [(sync_wallet.name, {"wallet_uuid": str(self.wallet.pk), "principal_id": self.tenant.user.pk})],
        )

    def test_the_same_challenge_and_signature_cannot_be_replayed(self):
        issued = self.client.post(f"/api/wallets/{self.wallet.uuid}/request-verification/")
        self.assertEqual(issued.status_code, 200)
        signature = self.signature(issued.json()["challenge"])
        first = self.client.post(
            f"/api/wallets/{self.wallet.uuid}/verify-signature/", {"signature": signature}, format="json"
        )
        self.assertEqual(first.status_code, 200)

        replay = self.client.post(
            f"/api/wallets/{self.wallet.uuid}/verify-signature/", {"signature": signature}, format="json"
        )

        self.assertEqual(replay.status_code, 400)
        self.assertEqual(replay.json()["detail"], VerificationChallengeNotFoundException.default_detail)
        self.wallet.refresh_from_db()
        self.assertIsNone(self.wallet.verification_challenge)
        with use_operator():
            self.assertEqual(WalletPossessionProof.objects.filter(wallet_id=self.wallet.pk).count(), 1)
        self.assertEqual(len(self.queued()), 1)
