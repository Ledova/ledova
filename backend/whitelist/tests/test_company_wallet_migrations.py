from django.db import connections
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from shared.db import current_alias, use_migrate, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import WalletPossessionProof
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletNomination,
    WhitelistChange,
)
from whitelist.tests.change_fixtures import CHAIN_ID, FACTORY, KEY
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases

SOURCE_TABLES = {
    "wallets_walletpossessionproof",
    "whitelist_companywalletnomination",
    "whitelist_companywalletinstruction",
    "whitelist_companywalletinstructiondecision",
}
BEFORE = [("whitelist", "0009_company_eligibility_invalidation"), ("wallets", "0023_transaction_market_value_aud")]
MODELS = [("whitelist", "0010_company_wallet_instructions")]
GUARDS = [("whitelist", "0011_company_wallet_instruction_guards")]


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class CompanyWalletMigrationTest(CompanyWalletCases, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(restore_every_migration)

    def migrate(self, target):
        with use_migrate():
            return migrate_to(target)

    def inventory(self):
        with use_migrate(), connections[current_alias()].cursor() as cursor:
            tables = set(connections[current_alias()].introspection.table_names(cursor))
            columns = {
                column.name
                for column in connections[current_alias()].introspection.get_table_description(
                    cursor, "whitelist_whitelistchange"
                )
            }
        return tables & SOURCE_TABLES, "source_instruction_id" in columns

    def test_empty_round_trip_preserves_existing_eligibility_and_wallet_facts(self):
        with use_operator():
            records = {
                row._meta.label: type(row).objects.filter(pk=row.pk).values().get()
                for row in (self.company, self.request, self.eligibility_decision, self.wallet)
            }
        self.assertEqual(self.inventory(), (SOURCE_TABLES, True))
        self.migrate(MODELS)
        self.migrate(BEFORE)
        self.assertEqual(self.inventory(), (set(), False))
        self.migrate(GUARDS)
        self.assertEqual(self.inventory(), (SOURCE_TABLES, True))
        with use_operator():
            self.assertEqual(
                {
                    row._meta.label: type(row).objects.filter(pk=row.pk).values().get()
                    for row in (self.company, self.request, self.eligibility_decision, self.wallet)
                },
                records,
            )
            self.assertFalse(CompanyWalletNomination.objects.exists())
            self.assertFalse(CompanyWalletInstruction.objects.exists())
            self.assertFalse(WhitelistChange.objects.exists())

    def test_proof_nomination_and_every_company_stage_refuse_history_erasing_reversal(self):
        nomination = self.nominate()
        with self.assertRaisesMessage(RuntimeError, "Retained company wallet sources"):
            self.migrate(MODELS)
        with use_operator():
            self.assertEqual(CompanyWalletNomination.objects.get().digest, nomination.digest)
        proposal = self.prepare_wallet(nomination)
        for phase in ("submitted", "approve", "apply"):
            with self.subTest(phase=phase):
                if phase != "submitted":
                    proposal, _ = self.wallet_decide(proposal, phase)
                with self.assertRaisesMessage(RuntimeError, "Retained company wallet sources"):
                    self.migrate(BEFORE)
                with use_operator():
                    proposal.refresh_from_db()
                    self.assertEqual(proposal.status, "applied" if phase == "apply" else "submitted")
        self.assertEqual(self.execute(proposal).status, "confirmed")

    def test_a_successful_proof_alone_refuses_erasing_its_producer_guards(self):
        proof = self.prove_wallet()
        with use_operator():
            original = WalletPossessionProof.objects.filter(pk=proof.pk).values().get()
            self.assertFalse(CompanyWalletNomination.objects.exists())
        with self.assertRaisesMessage(RuntimeError, "Retained wallet possession proofs"):
            self.migrate([("wallets", "0024_wallet_possession_proof")])
        restore_every_migration()
        with use_operator():
            self.assertEqual(WalletPossessionProof.objects.filter(pk=proof.pk).values().get(), original)
        nomination = self.nominate()
        self.assertEqual(nomination.wallet_id, self.wallet.pk)


class ScopedCompanyWalletMigrationTest(RunsOnTheScopedConnection, CompanyWalletMigrationTest):
    pass
