from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import (
    CHAIN_ID,
    KEY,
    admitted_signer,
    chain_client,
)
from companies.services.team import revoke_company_appointment
from shared.db import atomic
from shared.tests.tenants import make_tenant
from tokens.models import PauseChange
from tokens.services import pause_recovery
from tokens.tests.pause_fixtures import install_pause
from tokens.tests.retained_pause_fixtures import retain_pause_change


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
        revoke_company_appointment(requester=self.tenant.user, appointment_id=self.company_pause.initial.pk)
        refused = pause_recovery.recover(self.change.pk)
        self.assertEqual(refused.status, "failed")
        self.assertIsNotNone(refused.completed_at)
        for changes in ({"status": "pending"}, {"completed_at": None}, {"paused": not refused.paused}):
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=refused.pk).update(**changes)
        with self.assertRaisesMessage(DatabaseError, "Only an executing pause"):
            outgoing.open_operation(f"token-pause:{refused.pk}", **(refused.intent | {"value": 0}))

    def test_foundation_cannot_restart_a_terminal_pause_submission(self):
        self.node.receipt_status = 0
        pause_recovery.recover(self.change.pk)
        operation = OutgoingOperation.objects.get(operation_key=f"token-pause:{self.change.pk}")
        with self.assertRaisesMessage(DatabaseError, "new pause attempt"):
            outgoing.open_operation(operation.operation_key, **(operation.intent | {"value": 0}))
        self.assertEqual(PauseChange.objects.get(pk=self.change.pk).status, "failed")


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class RetainedPauseHistoryTest(TransactionTestCase):

    def test_retained_signed_pause_keeps_its_bytes_and_null_company_source(self):
        tenant = make_tenant("legacy-pause-retained")
        admitted_signer()
        change = retain_pause_change(tenant.deployed_token, tenant.user, signed=True)
        attempt = change.operation.current_attempt
        original = bytes(attempt.raw_transaction), attempt.tx_hash, attempt.nonce
        self.assertIsNone(change.source_pause_id)
        with self.assertRaisesMessage(DatabaseError, "Retain the original pause source association"), atomic():
            PauseChange.objects.filter(pk=change.pk).update(source_pause_id=uuid4())
        attempt.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual((bytes(attempt.raw_transaction), attempt.tx_hash, attempt.nonce), original)
        self.assertIsNone(change.source_pause_id)
        self.assertTrue(PauseChange.objects.filter(pk=change.pk).exists())

    def test_raw_predecessor_unsigned_execution_cannot_gain_a_fresh_signature_under_current_guards(self):
        tenant = make_tenant("legacy-pause-unsigned")
        admitted_signer()
        change = retain_pause_change(tenant.deployed_token, tenant.user, executing=True)
        operation = change.operation
        claim = outgoing.open_operation(operation.operation_key, **(operation.intent | {"value": 0}))
        prepared = outgoing.prepare_operation(claim, chain_client())
        nonce = SigningAccount.objects.get().next_nonce
        with self.assertRaises(outgoing.OutgoingTransactionError) as refusal:
            outgoing.sign_operation(claim, prepared, KEY)
        self.assertEqual(refusal.exception.__context__.__cause__.sqlstate, "23514")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        operation.refresh_from_db()
        self.assertEqual(operation.status, "preparing")
