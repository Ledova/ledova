from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from whitelist.models import WhitelistChange
from whitelist.services import changes
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    REGISTRY,
    SENDER,
    WhitelistNode,
    change_actor,
    change_company,
    change_entry,
)

BEFORE = [("whitelist", "0006_whitelist_change_guards")]


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class WhitelistChangeMigrationTest(TransactionTestCase):
    def setUp(self):
        self.node = WhitelistNode()
        patcher = patch.object(changes, "get_base_chain_client", return_value=self.node.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def truncate_the_journal(self):
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE whitelist_whitelistchange")

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
        after = migrate_to(BEFORE)
        for original in saved:
            self.assertEqual(
                after.get_model("whitelist", "WhitelistEntry").objects.filter(pk=original["uuid"]).values().get(),
                original,
            )
        self.assertFalse(WhitelistChange.objects.exists())

    def test_per_company_approvals_keep_each_entrys_identity_and_drop_the_global_state(self):
        self.addCleanup(restore_every_migration)
        before = migrate_to(BEFORE)
        entry = before.get_model("whitelist", "WhitelistEntry").objects.create(
            address="0x" + "5" * 40, label="Synthetic treasury", status="active", is_whitelisted=True, notes="kept"
        )
        after = migrate_to([("whitelist", "0007_per_company_approvals")])
        self.assertEqual(
            after.get_model("whitelist", "WhitelistEntry").objects.filter(pk=entry.pk).values().get(),
            {
                "uuid": entry.pk,
                "created_at": entry.created_at,
                "updated_at": entry.updated_at,
                "wallet_id": None,
                "address": "0x" + "5" * 40,
                "label": "Synthetic treasury",
                "notes": "kept",
            },
        )
        self.assertFalse(after.get_model("whitelist", "WhitelistApproval").objects.exists())

    def test_the_fresh_start_refuses_a_journal_written_for_the_global_registry(self):
        self.addCleanup(restore_every_migration)
        before = migrate_to(BEFORE)
        self.addCleanup(self.truncate_the_journal)
        before.get_model("whitelist", "WhitelistChange").objects.create(
            action="add",
            address=ADDRESS,
            chain_id=CHAIN_ID,
            registry_address=REGISTRY,
            intent={
                "chain_id": CHAIN_ID,
                "sender": SENDER.lower(),
                "to": REGISTRY,
                "value": "0",
                "data": "0xe43252d7" + "0" * 24 + ADDRESS[2:],
            },
            initiated_by_id=change_actor().pk,
            authority="operator_api",
        )
        with self.assertRaisesMessage(RuntimeError, "Reset the database and redeploy the contracts"):
            migrate_to([("whitelist", "0007_per_company_approvals")])
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM whitelist_whitelistchange")
            self.assertEqual(cursor.fetchone()[0], 1)

    def test_reverse_refuses_to_discard_an_admitted_command(self):
        actor = change_actor()
        change_entry()
        change = changes._admit(uuid4(), "add", ADDRESS, actor, "operator_api", None, change_company(), None)
        with self.assertRaisesMessage(RuntimeError, "Cannot remove admitted whitelist recovery history"):
            migrate_to([("whitelist", "0004_failure_reconciled_at")])
        self.assertTrue(WhitelistChange.objects.filter(pk=change.pk).exists())

    def test_the_guard_binds_the_expiry_into_the_registry_call(self):
        actor = change_actor()
        company = change_company()
        other = "0x" + "b" * 40
        expires_at = (timezone.now() + timedelta(days=10)).replace(microsecond=0)
        terms = {
            "action": "add",
            "address": other,
            "chain_id": CHAIN_ID,
            "registry_address": REGISTRY,
            "intent": changes._intent("add", other, REGISTRY, expires_at),
            "authority": "operator_api",
            "company_id": company.pk,
            "initiated_by_id": actor.pk,
            "expires_at": expires_at,
        }
        for label, values, message in (
            ("another expiry", {"expires_at": expires_at + timedelta(seconds=1)}, "must bind its exact registry call"),
            ("no expiry", {"expires_at": None}, "must bind its exact registry call"),
            ("a fractional second", {"expires_at": expires_at + timedelta(microseconds=5)}, "a whole second"),
            ("a removal with an expiry", {"action": "remove"}, "on an addition"),
        ):
            with self.subTest(label=label), self.assertRaisesMessage(DatabaseError, message), atomic():
                WhitelistChange.objects.create(uuid=uuid4(), **(terms | values))
        self.assertFalse(WhitelistChange.objects.exists())
        WhitelistChange.objects.create(uuid=uuid4(), **terms)
        self.assertEqual(WhitelistChange.objects.get().expires_at, expires_at)
