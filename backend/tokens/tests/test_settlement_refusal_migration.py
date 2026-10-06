from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from assets.models import AssetChainDeployment
from feature_flags.models import FeatureFlag
from operators.models import Operator
from shared.db import use_migrate, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_eligible, make_tenant
from shared.utils.typed_data import (
    build_domain,
    recover_typed_data_signer,
    signable_message,
    typed_data_digest,
)
from tokens.exceptions import (
    CreateOrderInsufficientBalanceException,
    InvalidSettlementAmountException,
)
from tokens.models import OrderSubmission, SigningChallenge, TransferOrder
from tokens.services.signing_challenge import CHALLENGE_TYPES
from tokens.tests.order_submission_fixtures import CONTRACT, OWNER, SubmissionFixtures
from users.models import CompanyEligibilityDecision
from wallets.models import Wallet


class HistoricalRefusalFixtures(SubmissionFixtures):
    def setUp(self):
        APITransactionTestCase.setUp(self)
        cache.clear()
        self.addCleanup(cache.clear)
        configuration = override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
        configuration.enable()
        self.addCleanup(configuration.disable)
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.tenant = make_tenant("historical-refusal")
            make_eligible(self.tenant)
            Operator.get().supported_settlement_assets.set([self.tenant.refs.stablecoin])
            self.wallet = Wallet.objects.create(
                user_account=self.tenant.account, address=OWNER.address, chain="base", verification_status="VERIFIED"
            )
            self.initial_order_count = TransferOrder.objects.count()
        self.client.force_authenticate(self.tenant.user)
        self.submission_id = uuid4()
        self.assertFalse(CompanyEligibilityDecision.objects.filter(request__user_account=self.tenant.account).exists())

    def historical_refusal(self, target, refusal, **changes):
        body = self.body(**changes)
        historical = migrate_to([("tokens", target)])
        with use_migrate():
            token = historical.get_model("tokens", "ShareToken").objects.get(pk=body["token"])
            submissions = historical.get_model("tokens", "OrderSubmission").objects
            challenges = historical.get_model("tokens", "SigningChallenge").objects
            submission = submissions.create(
                submission_id=self.submission_id,
                owner_account_id=self.tenant.account.pk,
                wallet_id=self.wallet.pk,
                token_id=token.pk,
                initiated_by_id=self.tenant.user.pk,
                wallet_address=self.wallet.address,
                order_type=body["order_type"],
                quantity=body["quantity"],
                min_quantity=body["min_quantity"],
                price_per_share=Decimal(body["price_per_share"]),
                chain_id=settings.BLOCKCHAIN_CHAIN_ID,
                verifying_contract=token.contract_address,
                token_metadata={"name": token.name, "symbol": token.symbol},
            )
            domain = build_domain(settings.BLOCKCHAIN_CHAIN_ID, token.contract_address)
            types = deepcopy(CHALLENGE_TYPES["order_create"])
            expires = timezone.now() + timedelta(minutes=5)
            message = {
                "submissionId": str(self.submission_id),
                "ownerAccountUuid": str(self.tenant.account.pk),
                "walletUuid": str(self.wallet.pk),
                "tokenUuid": str(token.pk),
                "orderType": body["order_type"],
                "quantity": str(body["quantity"]),
                "minQuantity": str(body["min_quantity"]),
                "pricePerShare": body["price_per_share"],
                "wallet": self.wallet.address,
                "nonce": "111",
                "deadline": str(int(expires.timestamp())),
            }
            signature = OWNER.sign_message(signable_message(domain, types, message)).signature.to_0x_hex()
            self.assertEqual(recover_typed_data_signer(domain, types, message, signature), self.wallet.address)
            challenge = challenges.create(
                purpose="order_create",
                wallet_id=self.wallet.pk,
                submission_id=submission.pk,
                wallet_address=self.wallet.address,
                chain_id=domain["chainId"],
                verifying_contract=domain["verifyingContract"],
                payload={"domain": domain, "types": types, "message": message},
                digest=typed_data_digest(domain, types, message),
                nonce=111,
                expires_at=expires,
            )
            consumed = timezone.now()
            challenges.filter(pk=challenge.pk).update(consumed_at=consumed, consumed_signature=signature)
            submissions.filter(pk=submission.pk).update(
                status="refused",
                executed_challenge_id=challenge.pk,
                refusal_code=refusal.default_code,
                refusal_detail=str(refusal.detail),
                resolved_at=consumed,
            )
        restore_every_migration()
        with use_operator():
            self.assertIsNone(OrderSubmission.objects.get(pk=submission.pk).eligibility_decision_id)
            spent = SigningChallenge.objects.get(pk=challenge.pk)
            self.assertEqual((spent.submission_id, spent.consumed_signature), (submission.pk, signature))
            self.assertIsNotNone(spent.consumed_at)
            self.assertFalse(
                CompanyEligibilityDecision.objects.filter(request__user_account=self.tenant.account).exists()
            )
        return {**body, "digest": challenge.digest, "signature": signature}


@skipUnless(getattr(settings, "MIGRATION_MODULES", {}).get("tokens", "enabled") is not None, "Requires migrations")
class SettlementRefusalMigrationTest(HistoricalRefusalFixtures, APITransactionTestCase):
    def test_existing_refusal_and_spent_challenge_survive_the_constraint_upgrade(self):
        self.addCleanup(restore_every_migration)
        self.share_balance = 0
        signed = self.historical_refusal(
            "0054_nav_update_guards",
            CreateOrderInsufficientBalanceException(balance=self.share_balance, required=10, token_symbol="DEP"),
            order_type="sell",
        )
        refused = self.create(signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "insufficient_balance")
        historical = migrate_to([("tokens", "0054_nav_update_guards")])
        with use_operator():
            submissions = historical.get_model("tokens", "OrderSubmission").objects
            challenges = historical.get_model("tokens", "SigningChallenge").objects
            before_submission = submissions.get(submission_id=self.submission_id)
            before_values = submissions.filter(pk=before_submission.pk).values().get()
            before_challenge = challenges.filter(pk=before_submission.executed_challenge_id).values().get()
        current = migrate_to([("tokens", "0055_order_submission_settlement_refusal")])
        with use_operator():
            after_values = (
                current.get_model("tokens", "OrderSubmission").objects.filter(pk=before_submission.pk).values().get()
            )
            after_challenge = (
                current.get_model("tokens", "SigningChallenge")
                .objects.filter(pk=before_submission.executed_challenge_id)
                .values()
                .get()
            )
        self.assertEqual(after_values, before_values)
        self.assertEqual(after_challenge, before_challenge)
        restore_every_migration()
        self.assertEqual(self.recover().json(), refused.json())

    def test_rollback_refuses_to_discard_a_new_permanent_outcome(self):
        self.addCleanup(restore_every_migration)
        self.counter_order()
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=18)
        refused = self.create(
            self.historical_refusal("0055_order_submission_settlement_refusal", InvalidSettlementAmountException())
        )
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "invalid_settlement_amount")
        with use_operator():
            before = OrderSubmission.objects.filter(submission_id=self.submission_id).values().get()
        with self.assertRaises(IntegrityError):
            migrate_to([("tokens", "0054_nav_update_guards")])
        restore_every_migration()
        with use_operator():
            self.assertEqual(OrderSubmission.objects.filter(submission_id=self.submission_id).values().get(), before)
        self.assertEqual(self.recover().json(), refused.json())
