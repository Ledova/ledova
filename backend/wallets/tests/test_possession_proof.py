import json
from contextlib import ExitStack
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connections, transaction
from django.utils import timezone
from eth_account import Account
from eth_account.messages import encode_defunct
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from shared.db import atomic, current_alias, principal_of, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from users.models import UserAccount, UserProfile
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.exceptions import InvalidSignatureException, SignatureRequiredException
from wallets.models import Wallet, WalletPossessionProof
from wallets.services.possession_proof import (
    current_possession_proof,
    proof_producer,
    retain_possession_proof,
)
from wallets.services.verification import complete_wallet_verification
from wallets.services.wallets import generate_verification_challenge
from wallets.tasks.sync import sync_wallet


class WalletPossessionProofTest(APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.key = Account.from_key("0x" + "22" * 32)
        self.foreign_key = Account.from_key("0x" + "23" * 32)
        with use_operator():
            self.actor = get_user_model().objects.create_user(
                email="proof-owner@example.test", password="proof-password", is_email_verified=True
            )
            self.profile = UserProfile.objects.create(user=self.actor)
            self.account = UserAccount.objects.create(user_profile=self.profile)
            self.wallet = Wallet.objects.create(user_account=self.account, address=self.key.address, chain="base")
            foreign_actor = get_user_model().objects.create_user(
                email="proof-other@example.test", password="proof-password", is_email_verified=True
            )
            foreign_profile = UserProfile.objects.create(user=foreign_actor)
            self.foreign_account = UserAccount.objects.create(user_profile=foreign_profile)
        self.client.force_authenticate(self.actor)
        self.inspection = connections["default"].copy()
        self.addCleanup(self.inspection.close)

    def start(self):
        response = self.client.post(f"/api/wallets/{self.wallet.pk}/request-verification/")
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            self.wallet.refresh_from_db()
        self.assertEqual(response.json()["challenge"], self.wallet.verification_challenge)
        return self.wallet.verification_challenge

    def signature(self, challenge, key=None):
        return (key or self.key).sign_message(encode_defunct(text=challenge)).signature.to_0x_hex()

    def complete(self, signature):
        return self.client.post(
            f"/api/wallets/{self.wallet.pk}/verify-signature/", {"signature": signature}, format="json"
        )

    def jobs(self, connection=None):
        with use_operator():
            selected = connection or connections[current_alias()]
            with selected.cursor() as cursor:
                cursor.execute(
                    "SELECT task_name, args FROM procrastinate_jobs WHERE args->>'wallet_uuid' = %s ORDER BY id",
                    [str(self.wallet.pk)],
                )
                return [
                    (name, payload if isinstance(payload, dict) else json.loads(payload))
                    for name, payload in cursor.fetchall()
                ]

    def observed(self):
        with self.inspection.cursor() as cursor:
            cursor.execute(
                "SELECT verification_status, verification_challenge, verification_challenge_issued_at, "
                "verification_signature, verified_at FROM wallets WHERE uuid = %s",
                [self.wallet.pk],
            )
            wallet = cursor.fetchone()
            cursor.execute("SELECT count(*) FROM wallets_walletpossessionproof WHERE wallet_id = %s", [self.wallet.pk])
            proofs = cursor.fetchone()[0]
        return wallet, proofs, self.jobs(self.inspection)

    def proof(self):
        with use_operator():
            return WalletPossessionProof.objects.get(wallet_id=self.wallet.pk)

    def assert_current(self, proof, expected=True):
        with use_operator():
            self.wallet.refresh_from_db()
            selected = current_possession_proof(self.wallet)
            self.assertEqual(selected.pk if selected else None, proof.pk if expected else None)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT wallets_possession_proof_current(%s)", [proof.pk])
                self.assertEqual(cursor.fetchone()[0], expected)

    def assert_sql_refusal(self, operation):
        with use_operator():
            with self.assertRaises(IntegrityError) as failed:
                with atomic():
                    operation()
            self.assertEqual(failed.exception.__cause__.sqlstate, "23514")

    def test_genuine_signature_retains_the_exact_challenge_and_private_source_before_clearing_it(self):
        challenge = self.start()
        issued_at = self.wallet.verification_challenge_issued_at
        signature = self.signature(challenge)
        response = self.complete(signature)
        self.assertEqual(response.status_code, 200, response.content)
        proof = self.proof()
        self.assertEqual(
            (proof.wallet_id, proof.account_id, proof.profile_id, proof.verified_by_id, proof.address, proof.chain),
            (self.wallet.pk, self.account.pk, self.profile.pk, self.actor.pk, self.wallet.address, "base"),
        )
        self.assertEqual(
            (proof.challenge, proof.signature, proof.challenge_issued_at), (challenge, signature, issued_at)
        )
        self.assertEqual(
            proof.challenge_expires_at,
            issued_at + timedelta(minutes=settings.WALLET_VERIFICATION_CHALLENGE_MINUTES),
        )
        self.assertLessEqual(issued_at, proof.completed_at)
        self.assertLess(proof.completed_at, proof.challenge_expires_at)
        self.assertRegex(proof.digest, "^[0-9a-f]{64}$")
        self.assert_current(proof)
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_VERIFIED)
        self.assertEqual((self.wallet.verification_signature, self.wallet.verified_at), (signature, proof.completed_at))
        self.assertIsNone(self.wallet.verification_challenge)
        self.assertIsNone(self.wallet.verification_challenge_issued_at)
        self.assertEqual(
            self.jobs(), [(sync_wallet.name, {"wallet_uuid": str(self.wallet.pk), "principal_id": self.actor.pk})]
        )
        self.assertNotIn("signature", response.json())
        self.assertNotIn("challenge", response.json())

    def test_legacy_or_override_status_has_no_proof_and_real_refresh_retains_both_original_proofs(self):
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
                verification_signature="historical-signature-with-no-retained-challenge",
                verified_at=timezone.now(),
            )
            self.wallet.refresh_from_db()
            self.assertIsNone(current_possession_proof(self.wallet))
            self.assertFalse(WalletPossessionProof.objects.exists())
        challenge = self.start()
        self.assertEqual(self.complete(self.signature(challenge)).status_code, 200)
        first = self.proof()
        with use_operator():
            retained = WalletPossessionProof.objects.values().get(pk=first.pk)
        second_challenge = self.start()
        self.assertNotEqual(second_challenge, first.challenge)
        self.assertEqual(self.complete(self.signature(second_challenge)).status_code, 200)
        with use_operator():
            self.wallet.refresh_from_db()
            second = current_possession_proof(self.wallet)
            self.assertEqual(WalletPossessionProof.objects.count(), 2)
            self.assertEqual(WalletPossessionProof.objects.values().get(pk=first.pk), retained)
        self.assertNotEqual(first.pk, second.pk)
        self.assert_current(second)

    def test_wrong_signer_wrong_challenge_missing_signature_and_expired_or_future_challenge_have_no_effect(self):
        old_challenge = self.start()
        current = self.start()
        attempts = (
            (self.signature(current, self.foreign_key), InvalidSignatureException.default_detail),
            (self.signature(old_challenge), InvalidSignatureException.default_detail),
            ("", SignatureRequiredException.default_detail),
        )
        before = self.observed()
        for signature, detail in attempts:
            with self.subTest(detail=detail, signature_matches_old=signature == self.signature(old_challenge)):
                response = self.complete(signature)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["detail"], detail)
                self.assertEqual(self.observed(), before)
        lifetime = timedelta(minutes=settings.WALLET_VERIFICATION_CHALLENGE_MINUTES)
        for issued_at in (timezone.now() - lifetime - timedelta(seconds=1), timezone.now() + timedelta(seconds=5)):
            with self.subTest(issued_at=issued_at):
                challenge = generate_verification_challenge(self.wallet.address, issued_at)
                with use_operator():
                    Wallet.objects.filter(pk=self.wallet.pk).update(
                        verification_challenge=challenge, verification_challenge_issued_at=issued_at
                    )
                before = self.observed()
                response = self.complete(self.signature(challenge))
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("expired", response.json()["detail"])
                self.assertEqual(self.observed(), before)
        challenge = self.start()
        self.assertEqual(self.complete(self.signature(challenge)).status_code, 200)
        self.assert_current(self.proof())

    def test_proofs_are_immutable_and_a_current_wallet_tuple_cannot_borrow_an_original_proof(self):
        challenge = self.start()
        self.assertEqual(self.complete(self.signature(challenge)).status_code, 200)
        proof = self.proof()
        with use_operator():
            retained = WalletPossessionProof.objects.values().get(pk=proof.pk)
        self.assert_sql_refusal(lambda: WalletPossessionProof.objects.filter(pk=proof.pk).update(signature="different"))
        self.assert_sql_refusal(lambda: WalletPossessionProof.objects.filter(pk=proof.pk).delete())
        for fields in (
            {"user_account_id": self.foreign_account.pk},
            {"address": self.foreign_key.address},
            {"chain": "ethereum"},
            {"verification_signature": "different"},
            {"verified_at": proof.completed_at + timedelta(microseconds=1)},
        ):
            with self.subTest(fields=fields), use_operator(), atomic():
                Wallet.objects.filter(pk=self.wallet.pk).update(**fields)
                self.assert_current(proof, False)
                transaction.set_rollback(True, using=current_alias())
        with use_operator():
            self.assertEqual(WalletPossessionProof.objects.values().get(pk=proof.pk), retained)
        self.assert_current(proof)

    def test_incomplete_producer_or_unbound_insert_cannot_commit_a_proof(self):
        challenge = self.start()
        signature = self.signature(challenge)
        before = self.observed()

        def retain():
            return retain_possession_proof(self.wallet, self.actor, signature, timezone.now())

        self.assert_sql_refusal(retain)
        for field, value in (
            ("address", self.foreign_key.address),
            ("chain", "ethereum"),
            ("verification_challenge", generate_verification_challenge(self.wallet.address)),
            ("verification_challenge_issued_at", self.wallet.verification_challenge_issued_at + timedelta(seconds=1)),
            ("user_account_id", self.foreign_account.pk),
        ):
            with self.subTest(field=field):

                def forge():
                    forged = Wallet.objects.get(pk=self.wallet.pk)
                    setattr(forged, field, value)
                    retain_possession_proof(forged, self.actor, signature, timezone.now())

                with use_operator(), _requester_principal(self.actor.pk), proof_producer():
                    self.assert_sql_refusal(forge)
                self.assertEqual(self.observed(), before)
        with use_operator(), _requester_principal(self.actor.pk):
            with self.assertRaises(IntegrityError) as failed:
                with atomic(), proof_producer():
                    retain()
                    self.assertEqual(WalletPossessionProof.objects.count(), 1)
                    self.assertEqual(self.observed(), before)
            self.assertEqual(failed.exception.__cause__.sqlstate, "23514")
        self.assertEqual(self.observed(), before)
        self.assertEqual(self.complete(signature).status_code, 200)
        self.assert_current(self.proof())

    def test_service_preserves_an_immediate_database_refusal_and_rolls_back_without_masking_it(self):
        challenge = "Historical challenge with no producer nonce"
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(
                verification_challenge=challenge, verification_challenge_issued_at=timezone.now()
            )
        before = self.observed()
        with self.assertRaises(IntegrityError) as failed:
            complete_wallet_verification(self.actor, self.wallet.pk, self.signature(challenge))
        self.assertEqual(failed.exception.__cause__.sqlstate, "23514")
        self.assertEqual(self.observed(), before)
        challenge = self.start()
        self.assertEqual(self.complete(self.signature(challenge)).status_code, 200)
        self.assert_current(self.proof())

    def test_the_actual_active_alias_queue_is_invisible_before_commit_and_rolls_back_with_completion(self):
        challenge = self.start()
        before = self.observed()
        calls = []

        def recorder(execute, sql, params, many, context):
            if "procrastinate_defer" in sql:
                calls.append((context["connection"].alias, context["connection"].in_atomic_block, principal_of()))
            return execute(sql, params, many, context)

        with use_operator(), ExitStack() as stack:
            alias = current_alias()
            for name in self.databases:
                stack.enter_context(connections[name].execute_wrapper(recorder))
            with atomic():
                complete_wallet_verification(self.actor, self.wallet.pk, self.signature(challenge))
                self.assertEqual(WalletPossessionProof.objects.count(), 1)
                self.assertEqual(len(self.jobs()), 1)
                self.assertEqual(self.observed(), before)
                transaction.set_rollback(True, using=alias)
        self.assertEqual(calls, [(alias, True, str(self.actor.pk))])
        self.assertEqual(self.observed(), before)
        self.assertEqual(self.complete(self.signature(challenge)).status_code, 200)
        self.assert_current(self.proof())
        self.assertEqual(len(self.jobs()), 1)

    def test_default_deferred_expiry_uses_the_real_clock_and_rolls_back_proof_wallet_and_queue(self):
        lifetime = timedelta(minutes=settings.WALLET_VERIFICATION_CHALLENGE_MINUTES)
        issued_at = timezone.now() - lifetime + timedelta(seconds=0.7)
        challenge = generate_verification_challenge(self.wallet.address, issued_at)
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(
                verification_challenge=challenge, verification_challenge_issued_at=issued_at
            )
        before = self.observed()
        with use_operator():
            with self.assertRaises(IntegrityError) as failed:
                with atomic():
                    complete_wallet_verification(self.actor, self.wallet.pk, self.signature(challenge))
                    self.assertEqual(WalletPossessionProof.objects.count(), 1)
                    self.assertEqual(len(self.jobs()), 1)
                    self.assertEqual(self.observed(), before)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM "
                            "(%s::timestamptz - clock_timestamp()))) + 0.03)",
                            [issued_at + lifetime],
                        )
            self.assertEqual(failed.exception.__cause__.sqlstate, "23514")
        self.assertEqual(self.observed(), before)
        challenge = self.start()
        self.assertEqual(self.complete(self.signature(challenge)).status_code, 200)
        self.assert_current(self.proof())
        self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_VERIFIED)
        self.assertNotEqual(before[0][0], WALLET_VERIFICATION_STATUS_VERIFIED)


class ScopedWalletPossessionProofTest(RunsOnTheScopedConnection, WalletPossessionProofTest):
    pass
