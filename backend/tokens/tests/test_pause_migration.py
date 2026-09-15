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
from tokens.models import PauseChange, ShareToken
from tokens.services import pause_changes, pause_recovery
from tokens.tests.pause_fixtures import install_pause


class PauseHistoricalMigrationTest(TransactionTestCase):
    def test_migration_preserves_existing_token_status_without_admitting_historical_authority(self):
        tenant = make_tenant("historical-pause")
        self.addCleanup(restore_every_migration)
        before = migrate_to([("tokens", "0050_swap_approval_guards")])
        old = before.get_model("tokens", "ShareToken").objects
        old.filter(pk=tenant.deployed_token.pk).update(status="paused")
        original = old.filter(pk=tenant.deployed_token.pk).values().get()
        restore_every_migration()
        self.assertEqual(ShareToken.objects.filter(pk=tenant.deployed_token.pk).values().get(), original)
        self.assertFalse(PauseChange.objects.exists())


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class PauseGuardTest(TransactionTestCase):
    def setUp(self):
        install_pause(self)

    def test_every_admitted_identity_field_and_delete_are_guarded(self):
        for field, value in {
            "uuid": uuid4(),
            "token_id": uuid4(),
            "company_id": uuid4(),
            "authority": "staff",
            "paused": False,
            "chain_id": CHAIN_ID + 1,
            "contract_address": "0x" + "d" * 40,
            "intent": {},
            "created_at": timezone.now(),
        }.items():
            with self.subTest(field=field), self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=self.change.pk).update(**{field: value})
        with self.assertRaisesMessage(DatabaseError, "cannot be deleted"), atomic():
            self.change.delete()

    def test_observation_requires_evidence_and_cannot_be_reopened(self):
        with self.assertRaises(DatabaseError), atomic():
            PauseChange.objects.filter(pk=self.change.pk).update(status="observed")
        self.node.paused = True
        pause_recovery.recover(self.change.pk)
        for changes in ({"status": "pending"}, {"completed_at": None}, {"observation": {}}, {"paused": False}):
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=self.change.pk).update(**changes)
        with self.assertRaisesMessage(DatabaseError, "Only an executing pause"):
            outgoing.open_operation(f"token-pause:{self.change.pk}", **(self.change.intent | {"value": 0}))

    def test_pending_and_unadmitted_submissions_cannot_gain_an_outgoing_operation(self):
        for submission_id in (self.change.pk, uuid4()):
            with self.assertRaisesMessage(DatabaseError, "Only an executing pause"):
                outgoing.open_operation(f"token-pause:{submission_id}", **(self.change.intent | {"value": 0}))

    def test_unrelated_operation_and_premature_completion_are_refused(self):
        other = outgoing.open_operation("synthetic:other-pause", **(self.change.intent | {"value": 0}))
        with self.assertRaises(DatabaseError), atomic():
            PauseChange.objects.filter(pk=self.change.pk).update(status="executing", operation_id=other.operation_id)
        with self.assertRaises(DatabaseError), atomic():
            PauseChange.objects.filter(pk=self.change.pk).update(completed_at=timezone.now())

    def test_unsigned_refusal_cannot_reopen_release_its_identity_or_admit_an_operation(self):
        refused = pause_changes.submit(self.token, self.tenant.user, uuid4(), False)
        self.assertEqual(refused.status, "failed")
        self.assertIsNotNone(refused.completed_at)
        for changes in ({"status": "pending"}, {"completed_at": None}, {"paused": True}):
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=refused.pk).update(**changes)
        with self.assertRaisesMessage(DatabaseError, "Only an executing pause"):
            outgoing.open_operation(f"token-pause:{refused.pk}", **(refused.intent | {"value": 0}))

    def test_foundation_cannot_restart_a_terminal_pause_submission(self):
        self.node.receipt_status = 0
        pause_recovery.recover(self.change.pk)
        operation = OutgoingOperation.objects.get()
        with self.assertRaisesMessage(DatabaseError, "new pause attempt"):
            outgoing.open_operation(operation.operation_key, **(operation.intent | {"value": 0}))
        self.assertEqual(PauseChange.objects.get(pk=self.change.pk).status, "failed")

    def test_reverse_cannot_remove_pause_recovery_history(self):
        self.addCleanup(restore_every_migration)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove pause submission"):
            migrate_to([("tokens", "0050_swap_approval_guards")])
        restore_every_migration()
        self.assertTrue(PauseChange.objects.filter(pk=self.change.pk).exists())
