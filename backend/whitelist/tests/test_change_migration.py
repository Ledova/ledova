from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from shared.tests.schema import migrate_to, restore_every_migration
from whitelist.models import WhitelistChange
from whitelist.services import changes
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    KEY,
    REGISTRY,
    change_actor,
    change_entry,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, WHITELIST_CONTRACT_ADDRESS=REGISTRY)
class WhitelistChangeMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_legacy_entries_and_hashes_without_adopting_them(self):
        self.addCleanup(restore_every_migration)
        before = migrate_to([("whitelist", "0004_failure_reconciled_at")])
        entries = before.get_model("whitelist", "WhitelistEntry").objects
        saved = []
        for index, status in enumerate(("pending", "failed", "active", "removed"), start=1):
            entry = entries.create(
                address="0x" + str(index) * 40,
                label="Synthetic treasury",
                status=status,
                add_tx_hash="0x" + str(index) * 64,
                notes="Preserve original attribution",
            )
            saved.append(entries.filter(pk=entry.pk).values().get())
        after = migrate_to([("whitelist", "0006_whitelist_change_guards")])
        for original in saved:
            self.assertEqual(
                after.get_model("whitelist", "WhitelistEntry").objects.filter(pk=original["uuid"]).values().get(),
                original,
            )
        self.assertFalse(WhitelistChange.objects.exists())

    def test_reverse_refuses_to_discard_an_admitted_command(self):
        actor = change_actor()
        change_entry()
        change = changes._admit(uuid4(), "add", ADDRESS, actor, "operator_api", None)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted whitelist recovery history"):
            migrate_to([("whitelist", "0004_failure_reconciled_at")])
        self.assertTrue(WhitelistChange.objects.filter(pk=change.pk).exists())
