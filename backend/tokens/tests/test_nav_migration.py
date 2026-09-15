from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.models import OutgoingOperation
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import NAVUpdate, YieldToken
from tokens.services import legacy_outgoing_sources, nav, nav_recovery
from tokens.tests.nav_fixtures import install_nav


class NAVHistoricalMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_historical_rows_without_inventing_local_or_chain_authority(self):
        tenant = make_tenant("historical-nav")
        token = YieldToken.objects.create(name="Historical NAV", symbol="HISTORY", contract_address="0x" + "d" * 40)
        self.addCleanup(restore_every_migration)
        before = migrate_to([("tokens", "0052_pause_change_guards")])
        old_model = before.get_model("tokens", "NAVUpdate")
        old = old_model.objects.create(
            yield_token_id=token.pk,
            updated_by_id=tenant.user.pk,
            old_nav_per_token="1",
            new_nav_per_token="2",
            total_reserve_value="3",
        )
        original = old_model.objects.filter(pk=old.pk).values().get()
        restore_every_migration()
        row = NAVUpdate.objects.get(pk=old.pk)
        self.assertEqual(NAVUpdate.objects.filter(pk=old.pk).values(*original).get(), original)
        self.assertEqual(
            (row.mode, row.status, row.intent, row.operation_id, row.completed_at),
            ("historical", "historical", None, None, None),
        )
        self.assertEqual(nav_recovery.recover(row.pk).status, "historical")
        self.assertFalse(OutgoingOperation.objects.exists())
        with self.assertRaises(DatabaseError), atomic():
            NAVUpdate.objects.filter(pk=row.pk).update(mode="local", status="queued", intent={})


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class NAVGuardTest(TransactionTestCase):
    def setUp(self):
        install_nav(self)

    def test_immutable_admission_fields_and_history_cannot_be_deleted(self):
        for field, value in {
            "uuid": uuid4(),
            "yield_token_id": uuid4(),
            "updated_by_id": self.tenant.user.pk + 1,
            "mode": "local",
            "intent": {},
            "new_nav_per_token": "2",
            "old_nav_per_token": "2",
            "total_reserve_value": "2",
            "custodian_report_ref": "changed",
            "notes": "changed",
            "created_at": timezone.now(),
        }.items():
            with self.subTest(field=field), self.assertRaises(DatabaseError), atomic():
                NAVUpdate.objects.filter(pk=self.update.pk).update(**{field: value})
        with self.assertRaisesMessage(DatabaseError, "cannot be deleted"), atomic():
            self.update.delete()

    def test_premature_outcome_completion_and_unrelated_operation_are_refused(self):
        other = outgoing.open_operation("synthetic:other-nav", **(nav.transaction_intent(self.update) | {"value": 0}))
        for changes in (
            {"completed_at": timezone.now()},
            {"status": "applied"},
            {"status": "confirmed"},
            {"status": "executing", "operation_id": other.operation_id},
        ):
            with self.assertRaises(DatabaseError), atomic():
                NAVUpdate.objects.filter(pk=self.update.pk).update(**changes)

    def test_queued_nonexistent_local_and_completed_submissions_cannot_admit_chain_operations(self):
        for submission_id in (self.update.pk, uuid4()):
            with self.assertRaisesMessage(DatabaseError, "Only executing chain NAV"):
                outgoing.open_operation(
                    f"nav-update:{submission_id}", **(nav.transaction_intent(self.update) | {"value": 0})
                )
        nav_recovery.recover(self.update.pk)
        with self.assertRaises(DatabaseError), atomic():
            NAVUpdate.objects.filter(pk=self.update.pk).update(status="executing")
        local = nav.submit(self.token, self.tenant.user, uuid4(), "3", "1")
        with self.assertRaisesMessage(DatabaseError, "Only executing chain NAV"):
            outgoing.open_operation(f"nav-update:{local.pk}", **(nav.transaction_intent(self.update) | {"value": 0}))

    def test_unsigned_refusal_remains_permanent_and_foundation_cannot_restart_failed_chain_work(self):
        refused = nav.submit(self.token, self.tenant.user, uuid4(), "3", "1")
        for changes in ({"status": "queued"}, {"completed_at": None}, {"new_nav_per_token": "4"}):
            with self.assertRaises(DatabaseError), atomic():
                NAVUpdate.objects.filter(pk=refused.pk).update(**changes)
        self.node.receipt_status = 0
        nav_recovery.recover(self.update.pk)
        operation = OutgoingOperation.objects.get()
        with self.assertRaisesMessage(DatabaseError, "new NAV attempt"):
            outgoing.open_operation(operation.operation_key, **(operation.intent | {"value": 0}))

    def test_unresolved_target_identity_and_valuation_changes_are_guarded(self):
        for changes in (
            {"symbol": "OTHER"},
            {"decimals": 18},
            {"contract_address": "0x" + "e" * 40},
            {"nav_per_token": "2"},
            {"total_reserve_value": "3"},
            {"last_nav_update": timezone.now()},
        ):
            with self.assertRaises(DatabaseError), atomic():
                YieldToken.objects.filter(pk=self.token.pk).update(**changes)
        self.assertIsNotNone(nav_recovery.recover(self.update.pk).completed_at)
        YieldToken.objects.filter(pk=self.token.pk).update(nav_per_token="3")
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, 3)

    def test_signed_outcome_cannot_become_unsigned_failure_and_event_cannot_be_replaced(self):
        self.node.confirmed = False
        nav_recovery.recover(self.update.pk)
        for changes in ({"status": "failed"}, {"operation_id": None}, {"event": {}}):
            with self.assertRaises(DatabaseError), atomic():
                NAVUpdate.objects.filter(pk=self.update.pk).update(**changes)
        operation = OutgoingOperation.objects.get()
        self.node.receipts[operation.current_attempt.tx_hash] = self.node.receipt(operation.current_attempt)
        nav_recovery.recover(self.update.pk)
        with self.assertRaises(DatabaseError), atomic():
            NAVUpdate.objects.filter(pk=self.update.pk).update(event={})

    def test_new_admitted_nav_rows_are_not_inventoried_as_hashless_historical_work(self):
        rows = legacy_outgoing_sources.read_legacy_outgoing_sources()
        self.assertFalse(
            any(row["model"] == NAVUpdate._meta.label and row["uuid"] == str(self.update.pk) for row in rows)
        )
        historical = NAVUpdate.objects.create(
            yield_token=self.token,
            updated_by=self.tenant.user,
            old_nav_per_token="1",
            new_nav_per_token="1",
            total_reserve_value="1",
        )
        rows = legacy_outgoing_sources.read_legacy_outgoing_sources()
        self.assertTrue(
            any(row["model"] == NAVUpdate._meta.label and row["uuid"] == str(historical.pk) for row in rows)
        )

    def test_rollback_cannot_remove_admitted_nav_history(self):
        self.addCleanup(restore_every_migration)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted NAV"):
            migrate_to([("tokens", "0052_pause_change_guards")])
        restore_every_migration()
        self.assertTrue(NAVUpdate.objects.filter(pk=self.update.pk).exists())
