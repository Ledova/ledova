from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from companies.services.team import revoke_company_appointment
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import PauseChangeConflict, RegisterChangeConflict
from tokens.models import PauseChange, RegisterPauseChange, ShareIssuance, ShareRegister
from tokens.services import pause_changes
from tokens.services.register_pause_changes import (
    decide_pause_change,
    prepare_pause_change,
    preview_pause_change_decision,
)
from tokens.tests.company_pause_fixtures import CompanyPauseCases
from wallets.models import Holding

BASE = "/api/v1/tokens/register-pause-changes/"


class RegisterPauseChangesTest(RealRowContention, CompanyPauseCases, APITransactionTestCase):
    def test_company_prepare_approval_admission_and_original_pause_projection_are_separate(self):
        values = self.pause_payload()
        values.pop("actor")
        response = self.client.post(BASE, values, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["providedBy"], "company")
        self.assertIsNone(response.json()["execution"])
        with use_operator():
            proposal = RegisterPauseChange.objects.get(pk=response.json()["uuid"])
            self.assertFalse(PauseChange.objects.exists())
            holdings = Holding.objects.count()
        self.pause_decide(proposal, "approve")
        self.assertEqual(self.client.get(f"{BASE}{proposal.pk}/").json()["stage"], "approved")
        with use_operator():
            self.assertFalse(PauseChange.objects.exists())
        proposal, receipt = self.pause_decide(proposal, "apply")
        admitted = self.client.get(f"{BASE}{proposal.pk}/").json()["execution"]
        self.assertEqual(admitted["status"], "pending")
        self.assertEqual(admitted["submissionId"], str(proposal.pk))
        self.assertIsNone(admitted["txHash"])
        self.assertEqual(self.execute_pause(proposal).status, "confirmed")
        finished = self.client.get(f"{BASE}{proposal.pk}/").json()["execution"]
        self.assertEqual(finished["operationStatus"], "confirmed")
        self.assertIsNotNone(finished["completedAt"])
        self.assertIsNotNone(finished["txHash"])
        self.assertIsNone(finished["observation"])
        self.assertEqual(decide_pause_change(**receipt).pk, proposal.pk)
        with use_operator():
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "paused")
            self.assertEqual(Holding.objects.count(), holdings)
            self.assertFalse(ShareIssuance.objects.exists())
            self.assertFalse(ShareRegister.objects.exists())
            self.assertFalse(self.owner.is_staff)

    def test_strict_boolean_company_terms_and_changed_preparation_replay(self):
        values = self.pause_payload()
        for invalid in (0, 1, "true", "false", None):
            with self.assertRaises(ValidationError):
                prepare_pause_change(**(values | {"paused": invalid}))
            body = {key: value for key, value in values.items() if key != "actor"} | {"paused": invalid}
            self.assertEqual(self.client.post(BASE, body, format="json").status_code, 400)
        proposal = prepare_pause_change(**values)
        self.assertEqual(prepare_pause_change(**values).pk, proposal.pk)
        for changed in (
            {"paused": False},
            {"reason": "Changed reason"},
            {"authority_reference": "Other board reference"},
        ):
            with self.assertRaises(RegisterChangeConflict):
                prepare_pause_change(**(values | changed))
        for changed in (
            {"reason": " "},
            {"reason": "a" * 1001},
            {"authority_reference": ""},
            {"authority_reference": "a" * 256},
        ):
            with self.assertRaises(ValidationError):
                prepare_pause_change(**(values | changed))

    def test_observed_original_has_block_evidence_and_no_new_operation_attempt_or_nonce(self):
        self.node.paused = True
        proposal = self.applied_pause()
        with use_operator():
            original_attempts = SignedAttempt.objects.count()
        change = self.execute_pause(proposal)
        self.assertEqual(change.status, "observed")
        self.assertIsNotNone(change.completed_at)
        self.assertIsNone(change.operation_id)
        with use_operator():
            self.assertEqual(SignedAttempt.objects.count(), original_attempts)
            self.assertFalse(OutgoingOperation.objects.filter(operation_key=f"token-pause:{change.pk}").exists())
        receipt = self.client.get(f"{BASE}{proposal.pk}/").json()["execution"]
        self.assertEqual(receipt["observation"]["blockNumber"], 11)
        self.assertIsNone(receipt["txHash"])
        second = self.applied_pause(paused=False)
        self.assertEqual(self.execute_pause(second).status, "confirmed")
        self.assertEqual(self.execute_pause(proposal).status, "observed")
        with use_operator():
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "deployed")

    def test_narrow_nonowner_steps_current_private_reads_and_signed_recovery_after_source_loss(self):
        preparer, _, preparing = self.appointee("pause-preparer", ["prepare"])
        approver, _, approving = self.appointee("pause-approver", ["approve"])
        applier, _, applying = self.appointee("pause-applier", ["apply"])
        reader, _, reading = self.appointee("pause-reader", ["read_register"])
        proposal = self.prepare_pause(actor=preparer, appointment=preparing)
        self.client.force_authenticate(reader)
        self.assertEqual(self.client.get(f"{BASE}{proposal.pk}/").status_code, 200)
        _, preview = preview_pause_change_decision(
            actor=reader, pause_change_id=proposal.pk, appointment=reading.pk, kind="approve"
        )
        self.assertIn("appointment_capability_required", preview["unmet_requirements"])
        self.pause_decide(proposal, "approve", actor=approver, appointment=approving)
        proposal, _ = self.pause_decide(proposal, "apply", actor=applier, appointment=applying)
        self.node.confirmed = False
        self.assertIsNone(self.execute_pause(proposal).completed_at)
        with use_operator():
            change = PauseChange.objects.select_related("operation__current_attempt").get(pk=proposal.pk)
            attempt = change.operation.current_attempt
            original = bytes(attempt.raw_transaction), attempt.tx_hash, attempt.nonce
            self.assertEqual(change.initiated_by_id, applier.pk)
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        revoke_company_appointment(requester=self.owner, appointment_id=applying.pk)
        self.node.receipts[attempt.tx_hash] = self.node.receipt(attempt)
        self.assertEqual(self.execute_pause(proposal).status, "confirmed")
        with use_operator():
            attempt.refresh_from_db()
            self.assertEqual((bytes(attempt.raw_transaction), attempt.tx_hash, attempt.nonce), original)
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "paused")

    def test_consumed_appointment_loss_retires_only_never_signed_original_and_releases_target(self):
        approver, _, approving = self.appointee("pause-lapsed", ["approve"])
        proposal = self.prepare_pause()
        self.pause_decide(proposal, "approve", actor=approver, appointment=approving)
        self.pause_decide(proposal, "apply")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        change = self.execute_pause(proposal)
        self.assertEqual(change.status, "failed")
        self.assertIsNotNone(change.completed_at)
        self.assertIsNone(change.operation_id)
        replacement = self.applied_pause()
        self.assertEqual(self.execute_pause(replacement).status, "confirmed")

    def test_temporary_configuration_loss_retains_original_pending_without_nonce_or_attempt(self):
        proposal = self.applied_pause()
        with use_operator():
            before = SignedAttempt.objects.count()
        with self.settings(BLOCKCHAIN_OPERATOR_KEY="invalid"):
            change = self.execute_pause(proposal)
            self.assertEqual(change.status, "pending")
            self.assertIsNone(change.completed_at)
            self.assertIsNone(change.operation_id)
        with use_operator():
            self.assertEqual(SignedAttempt.objects.count(), before)
        self.assertEqual(self.execute_pause(proposal).status, "confirmed")

    def test_explicit_rejection_does_not_need_class_readiness_or_create_execution(self):
        proposal = self.prepare_pause()
        with self.settings(BLOCKCHAIN_OPERATOR_KEY="invalid"):
            proposal, _ = self.pause_decide(proposal, "reject", reason="Do not pause this class")
        self.assertEqual(proposal.status, "rejected")
        with use_operator():
            self.assertFalse(PauseChange.objects.exists())

    def test_competing_unresolved_target_does_not_consume_second_proposal(self):
        first = self.applied_pause()
        second = self.prepare_pause(paused=False)
        self.pause_decide(second, "approve")
        with self.assertRaises(PauseChangeConflict):
            self.pause_decide(second, "apply")
        with use_operator():
            second.refresh_from_db()
            self.assertEqual(second.status, "submitted")
            self.assertFalse(second.decisions.filter(kind="apply").exists())
            self.assertEqual(PauseChange.objects.count(), 1)
        self.execute_pause(first)
        self.assertEqual(self.pause_decide(second, "apply")[0].status, "applied")

    def test_fresh_issuer_admission_and_raw_unsigned_null_source_are_refused(self):
        with self.assertRaises(PauseChangeConflict):
            pause_changes.submit(self.token, self.owner, uuid4(), True)
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            intent = pause_changes.transaction_intent(self.token, True)
            PauseChange.objects.create(
                token_id=self.token.pk,
                company_id=self.company.pk,
                initiated_by=self.owner,
                authority="issuer",
                paused=True,
                chain_id=intent["chain_id"],
                contract_address=intent["to"],
                intent=intent,
            )
        with use_operator():
            self.assertFalse(PauseChange.objects.exists())
        self.assertEqual(self.execute_pause(self.applied_pause()).status, "confirmed")

    def test_raw_source_terms_and_consumed_approval_are_immutable(self):
        proposal = self.applied_pause()
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                RegisterPauseChange.objects.filter(pk=proposal.pk).update(paused=False)
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=proposal.pk).update(source_pause=None)
        self.assertEqual(self.execute_pause(proposal).status, "confirmed")

    def test_queue_failure_rolls_back_original_application_and_a_healthy_retry_queues_once(self):
        proposal = self.prepare_pause()
        self.pause_decide(proposal, "approve")
        with patch(
            "tokens.services.pause_changes.App.configure_task", side_effect=DatabaseError("Synthetic queue failure")
        ):
            with self.assertRaises(DatabaseError):
                self.pause_decide(proposal, "apply")
        with use_operator():
            proposal.refresh_from_db()
            self.assertEqual(proposal.status, "submitted")
            self.assertFalse(proposal.decisions.filter(kind="apply").exists())
            self.assertFalse(PauseChange.objects.exists())
        applied, values = self.pause_decide(proposal, "apply")
        self.assertEqual(decide_pause_change(**values).pk, applied.pk)
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM procrastinate_jobs WHERE args->>'submission_id'=%s", [str(proposal.pk)]
            )
            self.assertEqual(cursor.fetchone()[0], 1)

    def test_default_deferred_application_expiry_rolls_back_proposal_original_and_queue(self):
        approver, _, approving = self.appointee(
            "pause-commit-expiring", ["approve"], expires_at=timezone.now() + timedelta(seconds=2)
        )
        proposal = self.prepare_pause()
        self.pause_decide(proposal, "approve", actor=approver, appointment=approving)
        original = pause_changes.admit_company

        def delayed(*args):
            result = original(*args)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE args->>'submission_id'=%s", [str(proposal.pk)]
                )
                self.assertEqual(cursor.fetchone()[0], 1)
                cursor.execute("SELECT pg_sleep(2.1)")
            return result

        with patch.object(pause_changes, "admit_company", delayed), self.assertRaises(RegisterChangeConflict):
            self.pause_decide(proposal, "apply")
        with use_operator():
            proposal.refresh_from_db()
            self.assertEqual(proposal.status, "submitted")
            self.assertFalse(proposal.decisions.filter(kind="apply").exists())
            self.assertFalse(PauseChange.objects.exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE args->>'submission_id'=%s", [str(proposal.pk)]
                )
                self.assertEqual(cursor.fetchone()[0], 0)
        self.pause_decide(proposal, "approve")
        self.assertEqual(self.pause_decide(proposal, "apply")[0].status, "applied")

    def test_default_deferred_preparation_expiry_removes_only_failed_proposal_and_copied_file(self):
        preparer, _, preparing = self.appointee(
            "pause-prepare-expiring", ["prepare"], expires_at=timezone.now() + timedelta(seconds=2)
        )
        values = self.pause_payload(actor=preparer, appointment=preparing)
        original = RegisterPauseChange.save

        def delayed(row, *args, **kwargs):
            original(row, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT pg_sleep(2.1)")

        with patch.object(RegisterPauseChange, "save", delayed), self.assertRaises(RegisterChangeConflict):
            prepare_pause_change(**values)
        with use_operator():
            self.assertFalse(RegisterPauseChange.objects.exists())
            self.assertFalse(PauseChange.objects.exists())
        self.assertEqual(self.prepare_pause().status, "submitted")

    def test_source_retirement_requires_actual_consumed_lapse_and_default_signature_expiry_rolls_back_bytes_and_nonce(
        self,
    ):
        applier, _, applying = self.appointee(
            "pause-sign-expiring", ["apply"], expires_at=timezone.now() + timedelta(seconds=2)
        )
        proposal = self.prepare_pause()
        self.pause_decide(proposal, "approve")
        self.pause_decide(proposal, "apply", actor=applier, appointment=applying)
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=proposal.pk).update(status="failed", completed_at=timezone.now())
            from blockchain.models import SigningAccount

            before_nonce = SigningAccount.objects.get().next_nonce
        original = SignedAttempt.save

        def delayed(row, *args, **kwargs):
            original(row, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT pg_sleep(2.1)")

        with patch.object(SignedAttempt, "save", delayed):
            result = self.execute_pause(proposal)
        self.assertEqual(result.status, "failed")
        with use_operator():
            self.assertIsNotNone(result.completed_at)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=result.operation_id).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, before_nonce)
        replacement = self.applied_pause()
        self.assertEqual(self.execute_pause(replacement).status, "confirmed")

    def test_distinct_original_decision_actor_and_profile_contention_keeps_unsigned_claim_and_nonce(self):
        approver, _, approving = self.appointee("pause-lock-approver", ["approve"])
        applier, _, applying = self.appointee("pause-lock-applier", ["apply"])
        proposal = self.prepare_pause()
        self.pause_decide(proposal, "approve", actor=approver, appointment=approving)
        self.pause_decide(proposal, "apply", actor=applier, appointment=applying)
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
            rows = (approver, approving.appointee_profile, applier, applying.appointee_profile)
        for row in rows:
            acquired, release, pids = Event(), Event(), []

            def hold():
                connections.close_all()
                try:
                    with use_migrate(), atomic():
                        type(row).objects.select_for_update().get(pk=row.pk)
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT pg_backend_pid()")
                            pids.append(cursor.fetchone()[0])
                        acquired.set()
                        self.assertTrue(release.wait(10))
                finally:
                    connections.close_all()

            with self.subTest(row=row._meta.label), ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(hold)
                try:
                    self.assertTrue(acquired.wait(5))
                    result = self.execute_pause(proposal)
                    self.assertEqual(result.status, "executing")
                    with use_operator():
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT pg_backend_pid()")
                            self.assertNotEqual(cursor.fetchone()[0], pids[0])
                        self.assertEqual(OutgoingOperation.objects.get(pk=result.operation_id).status, "preparing")
                        self.assertFalse(SignedAttempt.objects.filter(operation_id=result.operation_id).exists())
                        self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
                finally:
                    release.set()
                future.result(timeout=5)
        self.assertFalse(self.node.broadcasts)
        self.assertEqual(self.execute_pause(proposal).status, "confirmed")

    def test_pause_signing_locks_exact_class_before_waiting_on_the_common_signer(self):
        proposal = self.applied_pause()
        with use_operator():
            signer = SigningAccount.objects.get()
            change = PauseChange.objects.get(pk=proposal.pk)
        result = self.while_row_is_held(
            lambda: self.execute_pause(proposal),
            signer,
            held=(self.company, self.token, proposal, change),
            wait_query="blockchain_signingaccount",
            no_key=True,
        )
        self.assertEqual(result.status, "confirmed")
        with use_operator():
            self.assertEqual(SignedAttempt.objects.filter(operation_id=result.operation_id).count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_exact_applied_receipt_replays_under_surviving_read_after_original_appointment_lapse(self):
        actor, _, applying = self.appointee("pause-replay-applier", ["apply"])
        proposal = self.prepare_pause()
        self.pause_decide(proposal, "approve")
        _, values = self.pause_decide(proposal, "apply", actor=actor, appointment=applying)
        revoke_company_appointment(requester=self.owner, appointment_id=applying.pk)
        self.appoint_actor(actor, ["read_register"])
        self.assertEqual(decide_pause_change(**values).pk, proposal.pk)
        with self.assertRaises(RegisterChangeConflict):
            decide_pause_change(**(values | {"preview_digest": "f" * 64}))
        with use_operator():
            self.assertEqual(PauseChange.objects.count(), 1)
            self.assertEqual(proposal.decisions.filter(kind="apply").count(), 1)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE args->>'submission_id'=%s", [str(proposal.pk)]
                )
                self.assertEqual(cursor.fetchone()[0], 1)


class ScopedRegisterPauseChangesTest(RunsOnTheScopedConnection, RegisterPauseChangesTest):
    pass
