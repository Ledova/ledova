from decimal import Decimal
from unittest import skipUnless

from django.conf import settings
from django.db import IntegrityError
from rest_framework.test import APITransactionTestCase

from shared.db import use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import OrderSubmission, TransferOrder, TransferOrderType
from tokens.tests.order_submission_fixtures import COUNTERPARTY, SubmissionFixtures
from tokens.tests.test_settlement_chain_agreement import (
    FOREIGN_ADDRESS,
    FOREIGN_CHAIN_ID,
    deployed_token,
)
from wallets.models import Wallet


@skipUnless(getattr(settings, "MIGRATION_MODULES", {}).get("tokens", "enabled") is not None, "Requires migrations")
class SettlementChainRefusalMigrationTest(SubmissionFixtures, APITransactionTestCase):
    def test_existing_refusal_and_spent_challenge_survive_the_constraint_upgrade(self):
        self.addCleanup(restore_every_migration)
        historical = migrate_to([("tokens", "0059_swap_approval_submission")])
        self.share_balance = 0
        signed = self.signed_body(self.body(order_type="sell"))
        refused = self.create(signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "insufficient_balance")
        with use_operator():
            submissions = historical.get_model("tokens", "OrderSubmission").objects
            challenges = historical.get_model("tokens", "SigningChallenge").objects
            before_submission = submissions.get(submission_id=self.submission_id)
            before_values = submissions.filter(pk=before_submission.pk).values().get()
            before_challenge = challenges.filter(pk=before_submission.executed_challenge_id).values().get()
        current = migrate_to([("tokens", "0060_order_submission_settlement_chain_refusal")])
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
        self.assertEqual(self.recover().json(), refused.json())

    def test_rollback_refuses_to_discard_a_new_chain_refusal(self):
        self.addCleanup(restore_every_migration)
        with use_operator():
            token = deployed_token(self.tenant, FOREIGN_CHAIN_ID, "FGN", FOREIGN_ADDRESS)
            counterparty = Wallet.objects.create(
                user_account=self.tenant.account,
                address=COUNTERPARTY.address,
                chain="base",
                verification_status="VERIFIED",
            )
            TransferOrder.objects.create(
                token=token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=counterparty,
                owner_account=self.tenant.account,
                wallet_address=counterparty.address,
                order_type=TransferOrderType.SELL,
                quantity=10,
                price_per_share=Decimal("2.50"),
            )
        refused = self.create(self.signed_body(self.body(token=str(token.pk))))
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "settlement_chain_disagreement")
        with use_operator():
            before = OrderSubmission.objects.filter(submission_id=self.submission_id).values().get()
        with self.assertRaises(IntegrityError):
            migrate_to([("tokens", "0059_swap_approval_submission")])
        restore_every_migration()
        with use_operator():
            self.assertEqual(OrderSubmission.objects.filter(submission_id=self.submission_id).values().get(), before)
        self.assertEqual(self.recover().json(), refused.json())
