from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from companies.services.authority_requests import _requester_principal
from companies.services.team import revoke_company_appointment
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Wallet, WalletPossessionProof
from wallets.services.registration import delete_wallet
from whitelist.exceptions import WhitelistChangeConflict
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletInstructionDecision,
    CompanyWalletNomination,
    WhitelistApproval,
    WhitelistChange,
    WhitelistInvalidationCause,
)
from whitelist.services import changes, refresh
from whitelist.services.company_wallet_instructions import (
    WALLET_INSTRUCTIONS,
    decide_wallet_instruction,
    prepare_wallet_instruction,
    preview_wallet_instruction_decision,
)
from whitelist.services.wallet_nominations import preview_wallet_nomination
from whitelist.tasks.company_wallet import execute_company_wallet_change
from whitelist.tests.change_fixtures import CHAIN_ID, FACTORY, KEY, REGISTRY
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases

NOMINATIONS = "/api/v1/whitelist/wallet-nominations/"
COMPANY_NOMINATIONS = "/api/v1/whitelist/company-wallet-nominations/"
INSTRUCTIONS = "/api/v1/whitelist/company-wallet-instructions/"
TARGETS = "/api/v1/whitelist/company-wallet-targets/"


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class CompanyWalletInstructionTest(CompanyWalletCases, APITransactionTestCase):

    def test_real_proof_and_explicit_nomination_are_separate_from_company_admission_and_execution(self):
        proposal, _ = self.applied_wallet()
        with use_operator():
            change = WhitelistChange.objects.get(pk=proposal.change_id)
            self.assertEqual(change.source_instruction_id, proposal.pk)
            self.assertEqual(change.initiated_by_id, self.owner.pk)
            self.assertEqual(change.status, "pending")
            self.assertFalse(SignedAttempt.objects.exists())
        completed = self.execute(proposal)
        self.assertEqual(completed.status, "confirmed")
        with use_operator():
            self.assertEqual(WhitelistApproval.objects.get(company=self.company).status, "active")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(self.node.expiries[self.wallet.address.lower()], int(proposal.expires_at.timestamp()))

    def test_company_reads_only_the_explicit_nomination_and_own_record_keeps_its_exact_receipt(self):
        nomination = self.nominate()
        with use_operator():
            unselected = Wallet.objects.create(user_account=self.account, address="0x" + "7" * 40, chain="base")
        self.client.force_authenticate(self.owner)
        result = self.client.get(COMPANY_NOMINATIONS, {"company": str(self.company.pk)})
        self.assertEqual(result.status_code, 200, result.content)
        item = result.json()["results"][0]
        self.assertEqual(item["uuid"], str(nomination.pk))
        self.assertEqual(item["address"], self.wallet.address.lower())
        for key in ("wallet", "proof", "account", "profile", "signature", "challenge", "submittedBy"):
            self.assertNotIn(key, item)
        self.assertNotIn(str(unselected.pk), result.content.decode())
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"{NOMINATIONS}{nomination.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"{COMPANY_NOMINATIONS}{nomination.pk}/").status_code, 404)
        self.client.force_authenticate(self.participant)
        own = self.client.get(f"{NOMINATIONS}{nomination.pk}/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual(own.json()["wallet"], str(self.wallet.pk))
        self.assertEqual(own.json()["proof"], str(nomination.proof_id))

    def test_status_override_has_no_possession_proof_and_refresh_uses_the_real_existing_producer(self):
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="VERIFIED", verified_at=timezone.now())
        preview = preview_wallet_nomination(actor=self.participant, request=self.request.pk, wallet=self.wallet.pk)
        self.assertIn("wallet_proof_required", preview["unmet_requirements"])
        self.assertFalse(preview["can_submit"])
        self.assertIsNone(preview["proof"])
        proof = self.prove_wallet()
        fresh = preview_wallet_nomination(actor=self.participant, request=self.request.pk, wallet=self.wallet.pk)
        self.assertTrue(fresh["can_submit"])
        self.assertEqual(fresh["proof"], str(proof.pk))

    def test_exact_applied_replay_survives_source_loss_and_changed_terms_conflict(self):
        nomination = self.nominate()
        prepare_values = dict(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            company=self.company.pk,
            action="add",
            nomination=getattr(nomination, "pk", nomination),
            expires_at=(timezone.now() + timedelta(days=30)).replace(microsecond=0),
        )
        proposal = prepare_wallet_instruction(**prepare_values)
        self.wallet_decide(proposal, "approve")
        applied, replay = self.wallet_decide(proposal, "apply")
        self.replace_source()
        self.assertEqual(prepare_wallet_instruction(**prepare_values).pk, applied.pk)
        self.assertEqual(decide_wallet_instruction(**replay).change_id, applied.change_id)
        with self.assertRaises(WhitelistChangeConflict):
            prepare_wallet_instruction(
                **{**prepare_values, "expires_at": prepare_values["expires_at"] + timedelta(seconds=1)}
            )
        with self.assertRaises(WhitelistChangeConflict):
            decide_wallet_instruction(**{**replay, "preview_digest": "0" * 64})
        with use_operator():
            self.assertEqual(
                CompanyWalletInstructionDecision.objects.filter(instruction=proposal, kind="apply").count(), 1
            )
            self.assertEqual(WhitelistChange.objects.filter(source_instruction=proposal).count(), 1)

    def test_expired_exact_eligibility_and_overlong_expiry_refuse_without_effect(self):
        nomination = self.nominate()
        with self.assertRaises(ValidationError):
            self.prepare_wallet(
                nomination,
                expires_at=self.eligibility_decision.expires_at.replace(microsecond=0) + timedelta(seconds=1),
            )
        self.replace_source()
        with self.assertRaises(ValidationError):
            self.prepare_wallet(nomination)
        with use_operator():
            self.assertFalse(CompanyWalletInstruction.objects.exists())
            self.assertFalse(WhitelistChange.objects.exists())
            self.assertFalse(SignedAttempt.objects.exists())

    def test_raw_source_and_old_staff_admissions_are_refused_with_healthy_company_control(self):
        nomination = self.nominate()
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                CompanyWalletNomination.objects.filter(pk=nomination.pk).update(sharing_accepted=False)
            with self.assertRaises(DatabaseError), atomic():
                WalletPossessionProof.objects.filter(pk=nomination.proof_id).delete()
            with self.assertRaises(DatabaseError), atomic():
                WhitelistChange.objects.create(
                    action="add",
                    address=self.wallet.address.lower(),
                    registry_address=REGISTRY,
                    company_id=self.company.pk,
                    chain_id=CHAIN_ID,
                    expires_at=(timezone.now() + timedelta(days=1)).replace(microsecond=0),
                    initiated_by=self.owner,
                    authority="whitelist_admin",
                    intent=changes._intent("add", self.wallet.address, REGISTRY, None),
                )
        proposal = self.prepare_wallet(nomination)
        self.wallet_decide(proposal, "approve")
        applied, _ = self.wallet_decide(proposal, "apply")
        self.assertEqual(self.execute(applied).status, "confirmed")

    def test_step_authority_and_real_source_row_contention_preserve_the_original_unsigned_claim(self):
        approver, _, approving = self.appointee("wallet-approver", ["approve"])
        applier, _, applying = self.appointee("wallet-applier", ["apply"])
        proposal = self.prepare_wallet()
        self.wallet_decide(proposal, "approve", actor=approver, appointment=approving.pk)
        applied, _ = self.wallet_decide(proposal, "apply", actor=applier, appointment=applying.pk)
        with use_operator():
            rows = (
                self.wallet,
                self.account,
                approver,
                approving.appointee_profile,
                applier,
                applying.appointee_profile,
            )
        for row in rows:
            with self.subTest(row=row._meta.label):
                acquired, release, observed = Event(), Event(), []

                def hold():
                    connections.close_all()
                    try:
                        with use_migrate(), atomic():
                            type(row).objects.select_for_update().get(pk=row.pk)
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                observed.append(cursor.fetchone()[0])
                            acquired.set()
                            self.assertTrue(release.wait(10))
                    finally:
                        connections.close_all()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(hold)
                    try:
                        self.assertTrue(acquired.wait(5))
                        self.assertEqual(self.execute(applied).status, "executing")
                        with use_operator():
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                self.assertNotEqual(cursor.fetchone()[0], observed[0])
                            operation = OutgoingOperation.objects.get()
                            self.assertEqual(operation.status, "preparing")
                            self.assertIsNone(operation.current_attempt_id)
                            self.assertFalse(SignedAttempt.objects.exists())
                            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
                    finally:
                        release.set()
                    future.result(timeout=5)
        self.assertEqual(execute_company_wallet_change.func(str(applied.change_id)), str(applied.change_id))
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get(pk=applied.change_id).status, "confirmed")
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(OutgoingOperation.objects.get().attempts.count(), 1)

    def test_default_deferred_apply_expiry_rolls_back_actual_queue_and_projection(self):
        applier, _, applying = self.appointee(
            "wallet-expiring-applier", ["apply"], expires_at=timezone.now() + timedelta(seconds=4)
        )
        proposal = self.prepare_wallet()
        self.wallet_decide(proposal, "approve")
        _, preview = preview_wallet_instruction_decision(
            actor=applier, instruction_id=proposal.pk, appointment=applying.pk, kind="apply", reason=""
        )
        admitted_change_ids = []

        def delay(*args):
            WALLET_INSTRUCTIONS.apply(*args)
            admitted_change_ids.append(str(args[0].change_id))
            observer = connections[current_alias()].copy(alias="wallet_queue_observer")
            try:
                with observer.cursor() as cursor:
                    cursor.execute(
                        "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'change_id'=%s",
                        [execute_company_wallet_change.name, str(args[0].change_id)],
                    )
                    self.assertEqual(cursor.fetchone()[0], 0)
            finally:
                observer.close()
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp())))+0.05)",
                    [applying.expires_at],
                )

        with patch(
            "whitelist.services.company_wallet_instructions.WALLET_INSTRUCTIONS",
            replace(WALLET_INSTRUCTIONS, apply=delay),
        ), self.assertRaises(WhitelistChangeConflict):
            decide_wallet_instruction(
                actor=applier,
                instruction_id=proposal.pk,
                appointment=applying.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
                reason="",
            )
        with use_operator():
            proposal.refresh_from_db()
            self.assertEqual(proposal.status, "submitted")
            self.assertIsNone(proposal.change_id)
            self.assertEqual(CompanyWalletInstructionDecision.objects.filter(instruction=proposal).count(), 1)
            self.assertFalse(WhitelistChange.objects.exists())
            self.assertFalse(WhitelistApproval.objects.exists())
            self.assertEqual(len(admitted_change_ids), 1)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'change_id'=%s",
                    [execute_company_wallet_change.name, admitted_change_ids[0]],
                )
                self.assertEqual(cursor.fetchone()[0], 0)
        applied, _ = self.wallet_decide(proposal, "apply")
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'change_id'=%s",
                [execute_company_wallet_change.name, str(applied.change_id)],
            )
            self.assertEqual(cursor.fetchone()[0], 1)
        self.assertEqual(self.execute(applied).status, "confirmed")

    def test_default_deferred_prepare_expiry_rolls_back_the_source(self):
        nomination = self.nominate()
        preparer, _, preparing = self.appointee(
            "wallet-expiring-preparer", ["prepare"], expires_at=timezone.now() + timedelta(seconds=3)
        )
        original_save = CompanyWalletInstruction.save

        def delay(proposal, *args, **kwargs):
            original_save(proposal, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp())))+0.05)",
                    [preparing.expires_at],
                )

        with patch.object(CompanyWalletInstruction, "save", delay), self.assertRaises(WhitelistChangeConflict):
            self.prepare_wallet(nomination, actor=preparer, appointment=preparing.pk)
        with use_operator():
            self.assertFalse(CompanyWalletInstruction.objects.exists())
            self.assertFalse(CompanyWalletInstructionDecision.objects.exists())
            self.assertEqual(CompanyWalletNomination.objects.count(), 1)
        self.assertEqual(self.prepare_wallet(nomination).status, "submitted")

    def test_default_deferred_signature_expiry_removes_attempt_and_nonce_without_fabricating_removal(self):
        applier, _, applying = self.appointee(
            "wallet-sign-expiry", ["apply"], expires_at=timezone.now() + timedelta(seconds=4)
        )
        proposal = self.prepare_wallet()
        self.wallet_decide(proposal, "approve")
        applied, _ = self.wallet_decide(proposal, "apply", actor=applier, appointment=applying.pk)
        original_save = SignedAttempt.save

        def delay(attempt, *args, **kwargs):
            original_save(attempt, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp())))+0.05)",
                    [applying.expires_at],
                )

        with patch.object(SignedAttempt, "save", delay):
            self.assertEqual(self.execute(applied).status, "failed")
        with use_operator():
            self.assertFalse(SignedAttempt.objects.exists())
            self.assertIsNone(OutgoingOperation.objects.get().current_attempt_id)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
            self.assertFalse(WhitelistChange.objects.filter(action="remove").exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_permanent_unsigned_source_loss_terminalises_original_before_genuine_automatic_removal(self):
        active, _ = self.applied_wallet()
        self.assertEqual(self.execute(active).status, "confirmed")
        with use_operator():
            approval = WhitelistApproval.objects.get(company=self.company)
        pending = self.prepare_wallet(active.nomination, expires_at=active.expires_at + timedelta(days=1))
        self.wallet_decide(pending, "approve")
        pending, _ = self.wallet_decide(pending, "apply")
        self.replace_source()
        with self.actual_operator():
            removed = refresh.refresh_approval(approval)
            pending_change = WhitelistChange.objects.get(pk=pending.change_id)
            self.assertEqual(pending_change.status, "failed")
            self.assertEqual(pending_change.operation.status, "failed")
            self.assertIsNone(pending_change.operation.current_attempt_id)
            self.assertEqual(removed.invalidation_cause, WhitelistInvalidationCause.SOURCE_WITHDRAWAL)
            self.assertEqual(removed.action, "remove")
            self.assertEqual(SignedAttempt.objects.count(), 2)
        self.node.confirmed = True
        with use_operator():
            self.assertEqual(changes.recover(removed.pk).status, "confirmed")
            self.assertEqual(WhitelistApproval.objects.get(company=self.company).status, "removed")

    def test_original_signed_recovery_and_company_removal_survive_wallet_deletion(self):
        applied, _ = self.applied_wallet()
        self.node.confirmed = False
        self.assertEqual(self.execute(applied).status, "executing")
        with use_operator():
            attempt = SignedAttempt.objects.get()
        replacement, _, appointment = self.appointee("wallet-remover", ["prepare", "approve", "apply"])
        revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
        self.node.confirmed = True
        self.assertEqual(self.execute(applied).status, "confirmed")
        with use_operator():
            self.assertEqual(SignedAttempt.objects.get().pk, attempt.pk)
            self.assertEqual(SignedAttempt.objects.get().raw_transaction, attempt.raw_transaction)
        with _requester_principal(self.participant.pk):
            delete_wallet(self.participant, self.wallet.pk)
        removed = self.prepare_wallet(
            actor=replacement,
            appointment=appointment.pk,
            action="remove",
            nomination=None,
            target_change=applied.change_id,
            expires_at=None,
        )
        self.wallet_decide(removed, "approve", actor=replacement, appointment=appointment.pk)
        removed, _ = self.wallet_decide(removed, "apply", actor=replacement, appointment=appointment.pk)
        self.assertEqual(self.execute(removed).status, "confirmed")
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertFalse(WhitelistApproval.objects.exists())
            self.assertEqual(
                WhitelistChange.objects.get(pk=removed.change_id).address, applied.snapshot["target"]["address"]
            )

    def test_rejection_remains_available_after_captured_wallet_deletion(self):
        proposal = self.prepare_wallet()
        with _requester_principal(self.participant.pk):
            delete_wallet(self.participant, self.wallet.pk)
        rejected, _ = self.wallet_decide(proposal, "reject", reason="The participant removed the nominated wallet")
        self.assertEqual(rejected.status, "rejected")
        with use_operator():
            self.assertFalse(WhitelistChange.objects.exists())


class ScopedCompanyWalletInstructionTest(RunsOnTheScopedConnection, CompanyWalletInstructionTest):
    pass
