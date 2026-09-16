from unittest import skipUnless

from django.conf import settings
from django.db import IntegrityError
from rest_framework.test import APITransactionTestCase

from assets.models import AssetChainDeployment
from shared.db import use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import OrderSubmission
from tokens.tests.order_submission_fixtures import SubmissionFixtures


@skipUnless(getattr(settings, "MIGRATION_MODULES", {}).get("tokens", "enabled") is not None, "Requires migrations")
class SettlementRefusalMigrationTest(SubmissionFixtures, APITransactionTestCase):
    def test_existing_refusal_and_spent_challenge_survive_the_constraint_upgrade(self):
        self.addCleanup(restore_every_migration)
        historical = migrate_to([("tokens", "0054_nav_update_guards")])
        signed = self.signed_body(self.body(order_type="sell"))
        self.share_balance = 0
        refused = self.create(signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "insufficient_balance")
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
        self.assertEqual(self.recover().json(), refused.json())

    def test_rollback_refuses_to_discard_a_new_permanent_outcome(self):
        self.addCleanup(restore_every_migration)
        self.counter_order()
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=18)
        refused = self.create(self.signed_body())
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
