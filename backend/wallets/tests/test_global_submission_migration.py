from decimal import Decimal
from unittest import skipUnless

from django.conf import settings
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, current_alias, use_operator
from shared.tests.schema import restore_every_migration
from tokens.services.signed_transactions import decode_signed_transaction
from wallets.models import WalletSubmission
from wallets.tests.test_global_submission_identity import GlobalSubmissionFixture

BEFORE = ("wallets", "0017_bitcoin_submission")
AFTER = ("wallets", "0018_global_submission_identity")
modules = getattr(settings, "MIGRATION_MODULES", {})
MIGRATIONS_ENABLED = not ("wallets" in modules and modules["wallets"] is None)


@skipUnless(connection.vendor == "postgresql" and MIGRATIONS_ENABLED, "Real PostgreSQL migrations are required")
class GlobalSubmissionMigrationTest(GlobalSubmissionFixture, APITransactionTestCase):
    def test_installation_keeps_existing_signed_intent_and_accounting(self):
        self.addCleanup(restore_every_migration)
        signed = self.signed()
        self.submit_direct(signed)
        before = self.all_financial_state()
        MigrationExecutor(connection).migrate([BEFORE])
        with use_operator():
            journal = list(WalletSubmission.objects.values())
        MigrationExecutor(connection).migrate([AFTER])
        restore_every_migration()
        self.assertEqual(self.all_financial_state(), before)
        with use_operator():
            self.assertEqual(list(WalletSubmission.objects.values()), journal)
        self.assertEqual(self.submit_direct(signed)["status"], "pending")
        self.assertEqual(self.all_financial_state(), before)

    def _conflicting_history_is_preserved(self, signed):
        self.addCleanup(restore_every_migration)
        self.submit_direct(self.signed())
        executor = MigrationExecutor(connection)
        executor.migrate([BEFORE])
        old = executor.loader.project_state([BEFORE]).apps
        transactions = old.get_model("wallets", "Transaction").objects
        holdings = old.get_model("wallets", "Holding").objects
        submissions = old.get_model("wallets", "WalletSubmission").objects
        raw = bytes(signed.raw_transaction)
        decoded = decode_signed_transaction(raw)
        with use_operator(), atomic():
            original = transactions.get(wallet_id=self.wallet.pk)
            original.pk = None
            original.wallet_id = self.other_wallet.pk
            original.user_account_id = self.other.account.pk
            original.tx_hash = signed.hash.to_0x_hex()
            original.amount = Decimal(decoded.value) / Decimal(10**18)
            original.save()
            journal = submissions.get(wallet_id=self.wallet.pk)
            journal.pk = None
            journal.wallet_id = self.other_wallet.pk
            journal.user_account_id = self.other.account.pk
            journal.transaction_id = original.pk
            journal.tx_hash = signed.hash.to_0x_hex()
            journal.raw_transaction = raw
            journal.intent.update(amount=str(original.amount), raw_amount=str(decoded.value), value=str(decoded.value))
            journal.save()
            before = list(transactions.order_by("pk").values()), list(holdings.order_by("pk").values())
            journals = list(submissions.order_by("pk").values())
            self.assertEqual(len(journals), 2)
            with self.assertRaisesRegex(RuntimeError, "retain these rows and reconcile ownership"):
                MigrationExecutor(connection).migrate([AFTER])
            self.assertEqual(
                (list(transactions.order_by("pk").values()), list(holdings.order_by("pk").values())), before
            )
            self.assertEqual(list(submissions.order_by("pk").values()), journals)
            transaction.set_rollback(True, using=current_alias())
        restore_every_migration()
        with use_operator():
            self.assertEqual(WalletSubmission.objects.count(), 1)

    def test_duplicate_transaction_history_stops_migration_without_rewriting_or_deleting_rows(self):
        self._conflicting_history_is_preserved(self.signed())

    def test_different_transactions_at_one_signer_nonce_stop_migration_without_choosing_an_owner(self):
        self._conflicting_history_is_preserved(self.signed(value=3 * 10**18))
