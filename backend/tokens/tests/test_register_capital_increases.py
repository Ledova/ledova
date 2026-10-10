from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from time import sleep
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from companies.services.team import revoke_company_appointment
from shared.db import atomic, current_alias, use_migrate, use_operator
from tokens.exceptions import CapitalIncreaseUnresolved, RegisterChangeConflict
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RegisterCapitalIncrease,
    RegisterCapitalIncreaseDecision,
    RequestStatus,
    ShareIssuance,
    ShareRegister,
)
from tokens.services.register_capital_increases import (
    decide_capital_increase,
    prepare_capital_increase,
    preview_capital_increase_decision,
)
from tokens.tests.company_capital_fixtures import CompanyCapitalCases
from wallets.models import Holding

BASE = "/api/v1/tokens/register-capital-increases/"


class RegisterCapitalIncreasesTest(CompanyCapitalCases, APITransactionTestCase):
    def test_company_approval_admission_and_original_cap_projection_are_separate_and_mint_nothing(self):
        values = self.capital_payload()
        del values["actor"]
        response = self.client.post(BASE, values, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual(row["stage"], "submitted")
        self.assertEqual(row["providedBy"], "company")
        self.assertIsNone(row["execution"])
        with use_operator():
            proposal = RegisterCapitalIncrease.objects.get(pk=row["uuid"])
            before_holdings = Holding.objects.count()
            self.assertEqual(proposal.request.status, RequestStatus.UNDER_REVIEW)
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.capital_decide(proposal, "approve")
        approved = self.client.get(f"{BASE}{proposal.pk}/").json()
        self.assertEqual((approved["status"], approved["stage"]), ("submitted", "approved"))
        self.queue.assert_not_called()
        proposal, _ = self.capital_decide(proposal, "apply")
        admitted = self.client.get(f"{BASE}{proposal.pk}/").json()
        self.assertEqual(admitted["execution"]["status"], "executing")
        self.assertIsNone(admitted["execution"]["txHash"])
        self.queue.assert_called_once()
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")
        finished = self.client.get(f"{BASE}{proposal.pk}/").json()
        self.assertEqual(finished["execution"]["operationStatus"], "confirmed")
        self.assertIsNotNone(finished["execution"]["txHash"])
        self.assertIsNotNone(finished["execution"]["projectedAt"])
        with use_operator():
            self.token.refresh_from_db()
            self.assertEqual(self.token.total_supply, "1100")
            self.assertFalse(ShareIssuance.objects.exists())
            self.assertFalse(ShareRegister.objects.exists())
            self.assertEqual(Holding.objects.count(), before_holdings)
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            self.assertEqual(execution.executed_by_id, self.owner.pk)
            self.assertFalse(self.owner.is_staff)

    def test_preparation_freezes_exact_positive_integer_arithmetic_and_changed_replay_conflicts(self):
        for additional, total in ((0, 1000), (-1, 999), (1, 1002), (1, 2147483648), (True, 1001)):
            with self.assertRaises(ValidationError):
                self.prepare_capital(additional_shares=additional, new_authorized_total=total)
        values = self.capital_payload()
        proposal = prepare_capital_increase(**values)
        self.assertEqual(prepare_capital_increase(**values).pk, proposal.pk)
        with self.assertRaises(RegisterChangeConflict):
            prepare_capital_increase(**(values | {"purpose": "Changed purpose"}))
        with use_operator():
            self.assertEqual(CapitalIncreaseRequest.objects.filter(status="under_review").count(), 1)
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.queue.assert_not_called()

    def test_narrow_nonowner_steps_and_register_only_reads_do_not_confer_decision_authority(self):
        preparer, _, preparing = self.appointee("capital-preparer", ["prepare"])
        approver, _, approving = self.appointee("capital-approver", ["approve"])
        applier, _, applying = self.appointee("capital-applier", ["apply"])
        reader, _, reading = self.appointee("capital-reader", ["read_register"])
        proposal = self.prepare_capital(actor=preparer, appointment=preparing)
        self.client.force_authenticate(reader)
        self.assertEqual(self.client.get(f"{BASE}{proposal.pk}/").status_code, 200)
        _, preview = preview_capital_increase_decision(
            actor=reader, capital_increase_id=proposal.pk, appointment=reading.pk, kind="approve"
        )
        self.assertIn("appointment_capability_required", preview["unmet_requirements"])
        self.capital_decide(proposal, "approve", actor=approver, appointment=approving)
        proposal, values = self.capital_decide(proposal, "apply", actor=applier, appointment=applying)
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")
        self.assertEqual(decide_capital_increase(**values).pk, proposal.pk)
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            self.assertEqual(execution.executed_by_id, applier.pk)
            self.assertEqual(proposal.submitted_by_id, preparer.pk)
        self.assertFalse(applier.is_staff)

    def test_queue_failure_rolls_back_application_and_rejection_releases_only_the_original_slot(self):
        proposal = self.prepare_capital()
        self.capital_decide(proposal, "approve")
        with patch("tokens.services.capital_execution._enqueue", side_effect=RuntimeError("Synthetic queue failure")):
            with self.assertRaises(RuntimeError):
                self.capital_decide(proposal, "apply")
        with use_operator():
            proposal.refresh_from_db()
            proposal.request.refresh_from_db()
            self.assertEqual((proposal.status, proposal.request.status), ("submitted", "under_review"))
            self.assertFalse(proposal.decisions.filter(kind="apply").exists())
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        proposal, values = self.capital_decide(proposal, "reject", reason="The company withdraws this capital increase")
        self.assertEqual(decide_capital_increase(**values).pk, proposal.pk)
        with use_operator():
            proposal.request.refresh_from_db()
            self.assertEqual(proposal.request.status, "rejected")
            self.assertEqual(proposal.request.rejection_reason, values["reason"])
        replacement = self.prepare_capital()
        self.assertNotEqual(replacement.request_id, proposal.request_id)

    def test_missing_or_changed_evidence_refuses_decisions_but_keeps_the_original_private_file(self):
        proposal = self.prepare_capital()
        with use_operator():
            with proposal.file.storage.open(proposal.file.name, "rb") as stored:
                original = stored.read()
            proposal.authority_evidence.file.storage.delete(proposal.authority_evidence.file.name)
        _, preview = preview_capital_increase_decision(
            actor=self.owner, capital_increase_id=proposal.pk, appointment=self.initial.pk, kind="approve"
        )
        self.assertIn("evidence_unavailable", preview["unmet_requirements"])
        self.capital_decide(proposal, "reject", reason="Original evidence unavailable")
        response = self.client.get(f"{BASE}{proposal.pk}/file/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(b"".join(response.streaming_content), original)

    def test_revoked_never_signed_consumed_appointment_retires_only_the_original_slot(self):
        applier, _, applying = self.appointee("capital-expiring-applier", ["apply"])
        proposal = self.prepare_capital()
        self.capital_decide(proposal, "approve")
        proposal, _ = self.capital_decide(proposal, "apply", actor=applier, appointment=applying)
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            original = execution.intent, execution.executed_by_id, execution.source_increase_id
        revoke_company_appointment(requester=self.owner, appointment_id=applying.pk)
        self.assertEqual(self.execute_capital(proposal)["status"], "failed")
        with use_operator():
            execution.refresh_from_db()
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(OutgoingOperation.objects.get(pk=execution.operation_id).status, "failed")
            self.assertFalse(CapitalIncreaseRequest.objects.filter(pk=proposal.request_id).in_flight().exists())
            self.assertEqual((execution.intent, execution.executed_by_id, execution.source_increase_id), original)
        replacement = self.prepare_capital()
        self.assertNotEqual(replacement.request_id, proposal.request_id)
        self.assertFalse(self.capital_node.broadcasts)

    def test_temporary_configuration_hold_retains_the_unsigned_original_slot_until_restored(self):
        proposal = self.applied_capital()
        with self.settings(BLOCKCHAIN_CHAIN_ID=84532):
            self.assertEqual(self.execute_capital(proposal)["status"], "executing")
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(OutgoingOperation.objects.get(pk=execution.operation_id).status, "preparing")
            self.assertTrue(CapitalIncreaseRequest.objects.filter(pk=proposal.request_id).in_flight().exists())
        with self.assertRaises(ValidationError) as refusal:
            self.prepare_capital()
        self.assertIn("capital_in_flight", str(refusal.exception.detail))
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")

    def test_unavailable_source_cap_read_holds_before_gas_signing_and_resumes_after_provider_restoration(self):
        proposal = self.applied_capital()
        call = self.capital_node.contract.functions.authorizedShares.return_value.call
        call.side_effect = ConnectionError("Synthetic cap read unavailable")
        self.assertEqual(self.execute_capital(proposal)["status"], "executing")
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(OutgoingOperation.objects.get(pk=execution.operation_id).status, "preparing")
            self.assertTrue(CapitalIncreaseRequest.objects.filter(pk=proposal.request_id).in_flight().exists())
        self.capital_node.client.estimate_gas.assert_not_called()
        self.assertFalse(self.capital_node.broadcasts)
        call.side_effect = lambda: self.capital_node.cap
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")

    def test_independent_actor_row_contention_holds_before_the_common_signer_and_resumes_after_release(self):
        proposal = self.applied_capital()
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce

        def recover():
            connections.close_all()
            try:
                with use_operator():
                    return self.execute_capital(proposal)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                get_user_model().objects.select_for_update().get(pk=self.owner.pk)
                result = pool.submit(recover).result(timeout=5)
                self.assertEqual(result["status"], "executing")
                execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
                self.assertEqual(OutgoingOperation.objects.get(pk=execution.operation_id).status, "preparing")
                self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
                self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        self.assertFalse(self.capital_node.broadcasts)
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")

    def test_actual_consumed_appointment_expiry_retires_the_never_signed_original_without_rewriting_terms(self):
        applier, _, applying = self.appointee(
            "capital-soon-expired-applier", ["apply"], expires_at=timezone.now() + timedelta(seconds=2)
        )
        proposal = self.prepare_capital()
        self.capital_decide(proposal, "approve")
        proposal, _ = self.capital_decide(proposal, "apply", actor=applier, appointment=applying)
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            original = execution.intent, execution.executed_by_id, execution.source_increase_id
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT GREATEST(0, EXTRACT(EPOCH FROM %s::timestamptz-clock_timestamp()))", [applying.expires_at]
                )
                delay = float(cursor.fetchone()[0])
        sleep(delay + 0.02)
        self.assertEqual(self.execute_capital(proposal)["status"], "failed")
        with use_operator():
            execution.refresh_from_db()
            self.assertEqual((execution.intent, execution.executed_by_id, execution.source_increase_id), original)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertFalse(CapitalIncreaseRequest.objects.filter(pk=proposal.request_id).in_flight().exists())
        self.assertNotEqual(self.prepare_capital().request_id, proposal.request_id)

    def test_deferred_commit_checks_expiry_and_rolls_back_the_original_approval(self):
        proposal = self.prepare_capital()
        approver, _, approving = self.appointee(
            "capital-commit-expiring-approver", ["approve"], expires_at=timezone.now() + timedelta(seconds=1)
        )
        original_save = RegisterCapitalIncreaseDecision.save

        def delayed(row, *args, **kwargs):
            original_save(row, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT pg_sleep(1.1)")

        with patch.object(RegisterCapitalIncreaseDecision, "save", delayed), self.assertRaises(RegisterChangeConflict):
            self.capital_decide(proposal, "approve", actor=approver, appointment=approving)
        with use_operator():
            self.assertFalse(proposal.decisions.exists())
            proposal.request.refresh_from_db()
            self.assertEqual(proposal.request.status, "under_review")
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.queue.assert_not_called()

    def test_deferred_preparation_expiry_rolls_back_request_source_and_private_copy(self):
        preparer, _, preparing = self.appointee(
            "capital-commit-expiring-preparer", ["prepare"], expires_at=timezone.now() + timedelta(seconds=1)
        )
        values = self.capital_payload(actor=preparer, appointment=preparing)
        original_save = RegisterCapitalIncrease.save

        def delayed(row, *args, **kwargs):
            original_save(row, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT pg_sleep(1.1)")

        before = set(Path(settings.PRIVATE_MEDIA_ROOT).rglob("*.bin"))
        with patch.object(RegisterCapitalIncrease, "save", delayed), self.assertRaises(RegisterChangeConflict):
            prepare_capital_increase(**values)
        with use_operator():
            self.assertFalse(RegisterCapitalIncrease.objects.exists())
            self.assertFalse(CapitalIncreaseRequest.objects.exists())
        self.assertEqual(set(Path(settings.PRIVATE_MEDIA_ROOT).rglob("*.bin")), before)

    def test_database_retains_source_and_append_only_decisions_without_raw_review_authority(self):
        proposal = self.prepare_capital()
        self.capital_decide(proposal, "approve")
        with use_operator():
            approval = proposal.decisions.get()
            for changes in (
                {"snapshot": {}},
                {"intent": {}},
                {"intent_digest": "0" * 64},
                {"evidence_fingerprint": "0" * 64},
                {"file": "companies/foreign/private.bin"},
                {"reviewed_by_id": self.owner.pk},
                {"approval_decision_id": approval.pk},
            ):
                with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                    RegisterCapitalIncrease.objects.filter(pk=proposal.pk).update(**changes)
            with self.assertRaises(DatabaseError), atomic():
                RegisterCapitalIncreaseDecision.objects.filter(pk=approval.pk).update(reason="Changed approval")
            with self.assertRaises(DatabaseError), atomic():
                approval.delete()
            with self.assertRaises(DatabaseError), atomic():
                proposal.delete()
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
            self.assertEqual(proposal.decisions.count(), 1)

    def test_original_signed_bytes_recover_after_human_source_loss(self):
        proposal = self.applied_capital()
        self.capital_node.confirmed = False
        self.assertEqual(self.execute_capital(proposal)["status"], "executing")
        with use_operator():
            execution = CapitalIncreaseExecution.objects.get(source_increase=proposal)
            attempt = SignedAttempt.objects.get(operation_id=execution.operation_id)
            original_bytes = bytes(attempt.raw_transaction)
        revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
        self.capital_node.confirmed = True
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")
        self.assertEqual(self.capital_node.broadcasts, [original_bytes, original_bytes])
        with use_operator():
            self.assertEqual(SignedAttempt.objects.filter(operation_id=execution.operation_id).count(), 1)
            self.assertEqual(CapitalIncreaseExecution.objects.get(pk=execution.pk).executed_by_id, self.owner.pk)

    def test_database_refuses_raw_status_only_review_and_retired_owner_submission(self):
        proposal = self.prepare_capital()
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                CapitalIncreaseRequest.objects.filter(pk=proposal.request_id).update(status="approved")
            with self.assertRaises(DatabaseError), atomic():
                RegisterCapitalIncrease.objects.filter(pk=proposal.pk).update(status="applied")
            with self.assertRaises(DatabaseError), atomic():
                CapitalIncreaseRequest.objects.filter(pk=proposal.request_id).update(additional_shares=101)
            self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.assertEqual(self.client.post("/api/v1/tokens/capital-increases/", {}, format="json").status_code, 405)
        self.assertEqual(
            self.client.post(
                f"/api/v1/tokens/capital-increases/{proposal.request_id}/submit/", {}, format="json"
            ).status_code,
            404,
        )

    def test_paused_class_increase_preserves_pause_and_matching_cap_without_original_event_is_unresolved(self):
        with use_operator():
            self.token.status = "paused"
            self.token.save(update_fields=["status", "updated_at"])
        proposal = self.applied_capital()
        self.capital_node.events_missing = True
        with self.assertRaises(CapitalIncreaseUnresolved):
            self.execute_capital(proposal)
        with use_operator():
            self.token.refresh_from_db()
            self.assertEqual((self.token.status, self.token.total_supply), ("paused", "1000"))
        self.assertEqual(self.capital_node.cap, 1100)
        self.capital_node.events_missing = False
        self.assertEqual(self.execute_capital(proposal)["status"], "executed")
        with use_operator():
            self.token.refresh_from_db()
            self.assertEqual((self.token.status, self.token.total_supply), ("paused", "1100"))
