from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APITransactionTestCase

from shared.tests.schema import restore_every_migration
from wallets.tests.test_wallet_finality import WalletFinalityFixture

BEFORE = ("wallets", "0020_transaction_monitoring_completed_at")
AFTER = ("wallets", "0021_transaction_finality_observation")


class FinalityMigrationTest(WalletFinalityFixture, APITransactionTestCase):
    def test_upgrade_preserves_existing_balances_and_does_not_invent_finality(self):
        self.addCleanup(restore_every_migration)
        before = self.financial_state()
        MigrationExecutor(connection).migrate([BEFORE])
        MigrationExecutor(connection).migrate([AFTER])
        restore_every_migration()
        self.assertEqual(self.financial_state(), before)
        self.assertIsNone(self.transactions()[0]["finality_observation_id"])
        self.assertEqual(self.finish()["status"], "confirmed")

    def test_rollback_refuses_to_discard_the_recorded_settlement_authority(self):
        self.addCleanup(restore_every_migration)
        self.assertEqual(self.finish()["status"], "confirmed")
        before = self.financial_state()
        with self.assertRaisesRegex(RuntimeError, "Retain the finality observation"):
            MigrationExecutor(connection).migrate([BEFORE])
        restore_every_migration()
        self.assertEqual(self.financial_state(), before)
