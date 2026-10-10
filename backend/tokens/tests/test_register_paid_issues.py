import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from companies.services.administration import company_operation
from companies.services.editing import update_company
from companies.services.team import revoke_company_appointment
from offerings.models import Offering, OfferingExemption, Subscription
from offerings.services.offering import submit_offering, transition_offering
from offerings.services.subscription import record_refund
from offerings.tests.factories import configure_operator, subscription_technical_actor
from shared.db import acting_for, atomic, current_alias, principal_of, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterInstruction,
    RegisterInstructionDecision,
    RequestStatus,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
)
from tokens.services.issuance_execution import _enqueue as actual_enqueue
from tokens.services.register_paid_issues import (
    PAID_ISSUES,
    _command,
    decide_paid_issue,
    prepare_paid_issue,
    preview_paid_issue_decision,
    ready_subscriptions,
    source_snapshot,
)
from tokens.tests.company_paid_issue_fixtures import CompanyPaidIssueCases
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY
from users.models import UserAccount, UserProfile
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from wallets.models import Wallet


class RegisterPaidIssuesTest(CompanyPaidIssueCases, APITransactionTestCase):
    def _wait_until(self, expires_at):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp()))) + 0.05)",
                [expires_at],
            )

    def test_genuine_payment_and_human_approval_admit_nothing_until_exact_company_application(self):
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        with use_operator():
            self.assertIsNone(proposal.request_id)
            self.assertIsNone(Subscription.objects.get(pk=self.subscription.pk).issuance_request_id)
            self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())
        proposal, _ = self.paid_decide(proposal, "apply")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(
                (execution.subscription_id, execution.executed_by_id, execution.authority),
                (self.subscription.pk, self.owner.pk, "company"),
            )
            self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).issuance_request_id, proposal.request_id)

    def test_original_paid_mint_allots_and_records_once_with_genuine_payment_backing(self):
        proposal = self.applied_paid_issue()
        self.assertEqual(self.execute_paid_issue(proposal)["status"], "executed")
        with use_operator():
            subscription = Subscription.objects.get(pk=self.subscription.pk)
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            entry = RegisterEntry.objects.get(operation_id=execution.issuance_id, kind="issue")
            self.assertEqual(subscription.status, "allotted")
            self.assertEqual(subscription.money_backing_shares, Decimal("62.50"))
            self.assertEqual(entry.changes, [{"member": str(self.member), "shares": "25"}])
            self.assertEqual(entry.recorded_by_id, self.owner.pk)
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 25)
        self.execute_paid_issue(proposal)
        with use_operator():
            self.assertEqual(RegisterEntry.objects.filter(operation_id=execution.issuance_id).count(), 1)

    def test_exact_replay_reuses_original_source_and_changed_body_conflicts(self):
        payload = self.paid_payload()
        proposal = prepare_paid_issue(**payload)
        self.assertEqual(prepare_paid_issue(**payload).pk, proposal.pk)
        with self.assertRaises(RegisterChangeConflict):
            prepare_paid_issue(**{**payload, "reason": "Changed authority terms"})
        self.paid_decide(proposal, "approve")
        applied, command = self.paid_decide(proposal, "apply")
        self.assertEqual(decide_paid_issue(**command).pk, applied.pk)
        self.assertEqual(prepare_paid_issue(**payload).request_id, applied.request_id)

    def test_rejection_preserves_paid_money_and_has_no_request_or_execution(self):
        proposal = self.prepare_paid_issue()
        rejected, _ = self.paid_decide(proposal, "reject", reason="Do not issue under this resolution")
        with use_operator():
            subscription = Subscription.objects.get(pk=self.subscription.pk)
            self.assertEqual(
                (rejected.status, rejected.request_id, subscription.status, subscription.amount_received),
                ("rejected", None, "paid", Decimal("62.50")),
            )
            self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())

    def test_queued_original_refund_cancels_execution_without_manufacturing_company_rejection(self):
        proposal = self.applied_paid_issue()
        with use_operator():
            record_refund(self.subscription, Decimal("62.50"), reference="ACTUAL-REFUND")
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
            self.assertEqual((execution.status, request.status), ("cancelled", RequestStatus.REJECTED))
            self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).status, "refunded")
            self.assertFalse(RegisterInstructionDecision.objects.filter(instruction=proposal, kind="reject").exists())
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())

    def test_paid_fulfilment_does_not_reapply_investor_standing_or_general_nomination_requirements(self):
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="rejected")
        applied, _ = self.paid_decide(proposal, "apply")
        self.assertEqual(self.execute_paid_issue(applied)["status"], "executed")

    def test_wallet_account_drift_hidden_by_the_same_name_refuses_new_paid_effects(self):
        from blockchain.models import SigningAccount

        with use_operator():
            profile = UserProfile.objects.get(pk=self.account.user_profile_id)
            UserProfile.objects.filter(pk=self.other_account.user_profile_id).update(full_name=profile.full_name)
            original_source = source_snapshot(Subscription.objects.with_relations().get(pk=self.subscription.pk))

        def move(account):
            with self.database_role("operator", self.participant):
                self.assertEqual(Wallet.objects.filter(pk=self.wallet.pk).update(user_account_id=account.pk), 1)
            with use_operator():
                self.assertEqual(
                    source_snapshot(Subscription.objects.with_relations().get(pk=self.subscription.pk)), original_source
                )

        payload = self.paid_payload()
        move(self.other_account)
        self.assertEqual(ready_subscriptions(actor=self.owner, company=self.company.pk, token=self.token.pk), [])
        with self.assertRaises(ValidationError):
            prepare_paid_issue(**payload)
        move(self.account)
        proposal = prepare_paid_issue(**payload)
        _, valid = preview_paid_issue_decision(
            actor=self.owner, paid_issue_id=proposal.pk, appointment=self.initial.pk, kind="approve"
        )
        move(self.other_account)
        _, stale = preview_paid_issue_decision(
            actor=self.owner, paid_issue_id=proposal.pk, appointment=self.initial.pk, kind="approve"
        )
        self.assertIn("subscription_source_changed", stale["unmet_requirements"])
        with _command(self.owner, proposal, "register_paid_issue_approve"), self.assertRaises(DatabaseError), atomic():
            RegisterInstructionDecision.objects.create(
                instruction=proposal,
                kind="approve",
                decided_by=self.owner,
                appointment=self.initial,
                idempotency_key=uuid4(),
                digest=valid["preview_digest"],
                reason="",
            )
        with self.assertRaises(ValidationError):
            self.paid_decide(proposal, "approve")
        move(self.account)
        self.paid_decide(proposal, "approve")
        applied, _ = self.paid_decide(proposal, "apply")
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
        move(self.other_account)
        self.assertEqual(self.execute_paid_issue(applied)["status"], "executing")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(execution.operation.status, "preparing")
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        move(self.account)
        self.assertEqual(self.execute_paid_issue(applied)["status"], "executed")

    def test_never_signed_mandate_loss_keeps_original_binding_and_never_auto_refunds_or_duplicates(self):
        actor, _, appointment = self.appointee(uuid4().hex, ["approve"])
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve", actor=actor, appointment=appointment.pk)
        applied, _ = self.paid_decide(proposal, "apply")
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        self.assertEqual(self.execute_paid_issue(applied)["status"], "failed")
        with use_operator():
            subscription = Subscription.objects.get(pk=self.subscription.pk)
            self.assertEqual(
                (subscription.status, subscription.issuance_request_id, subscription.refunded_at),
                ("paid", applied.request_id, None),
            )
            self.assertEqual(ShareIssuanceExecution.objects.filter(subscription_id=subscription.pk).count(), 1)
            self.assertEqual(ready_subscriptions(actor=self.owner, company=self.company.pk, token=self.token.pk), [])
        with self.assertRaises(ValidationError):
            self.prepare_paid_issue()

    def test_current_raw_staff_approval_is_refused_without_an_exact_company_application(self):
        with self.database_role("app", self.owner), self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.create(
                company=self.company,
                token=self.token,
                amount=25,
                recipient_address=self.wallet.address,
                status="approved",
                reviewed_by=self.technical,
                reviewed_at=timezone.now(),
            )
        proposal = self.applied_paid_issue()
        self.assertEqual(self.execute_paid_issue(proposal)["status"], "executed")

    def test_distinct_75_share_proposals_race_on_real_sessions_and_only_one_admits(self):
        subscriptions = [self.genuine_paid_subscription(quantity=75), self.genuine_paid_subscription(quantity=75)]
        proposals = [self.prepare_paid_issue(subscription=row.pk) for row in subscriptions]
        for proposal in proposals:
            self.paid_decide(proposal, "approve")
        previews = [
            preview_paid_issue_decision(
                actor=self.owner, paid_issue_id=proposal.pk, appointment=self.initial.pk, kind="apply"
            )[1]
            for proposal in proposals
        ]
        barrier, sessions = Barrier(2), []

        def apply(index):
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout='10s'")
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        sessions.append(cursor.fetchone())
                    barrier.wait(timeout=5)
                    try:
                        return decide_paid_issue(
                            actor=self.owner,
                            paid_issue_id=proposals[index].pk,
                            appointment=self.initial.pk,
                            kind="apply",
                            idempotency_key=uuid4(),
                            preview_digest=previews[index]["preview_digest"],
                            confirmation=True,
                        ).status
                    except (RegisterChangeConflict, ValidationError):
                        return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = [future.result(timeout=15) for future in [pool.submit(apply, index) for index in range(2)]]
        self.assertCountEqual(outcomes, ["applied", "refused"])
        self.assertEqual(len({row[0] for row in sessions}), 2)
        if isinstance(self, RunsOnTheScopedConnection):
            self.assertEqual({row[1] for row in sessions}, {settings.RLS_ROLES["operator"]})
        with use_operator():
            self.assertEqual(ShareIssuanceExecution.objects.filter(token_id=self.token.pk).count(), 1)
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 0)

    def test_default_deferred_apply_expiry_rolls_back_original_binding_and_actual_queue(self):
        actor, _, appointment = self.appointee(uuid4().hex, ["apply"], expires_at=timezone.now() + timedelta(seconds=4))
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        jobs = []

        def enqueue(execution):
            actual_enqueue(execution)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE args->>'execution_id'=%s", [str(execution.pk)]
                )
                jobs.append(cursor.fetchone()[0])
            observer = connections[current_alias()].copy(alias="paid_issue_queue_observer")
            try:
                with observer.cursor() as cursor:
                    cursor.execute(
                        "SELECT count(*) FROM procrastinate_jobs WHERE args->>'execution_id'=%s", [str(execution.pk)]
                    )
                    self.assertEqual(cursor.fetchone()[0], 0)
            finally:
                observer.close()

        @contextmanager
        def expire(actor, initial, operation, recorded=False):
            with _command(actor, initial, operation, recorded) as current:
                yield current
                if operation == "register_paid_issue_apply":
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT pg_sleep(GREATEST(0, "
                            "EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp()))) + 0.1)",
                            [appointment.expires_at],
                        )

        with patch("tokens.services.register_paid_issues.PAID_ISSUES", replace(PAID_ISSUES, command=expire)), patch(
            "tokens.services.issuance_execution._enqueue", side_effect=enqueue
        ), self.assertRaises(RegisterChangeConflict):
            self.paid_decide(proposal, "apply", actor=actor, appointment=appointment.pk)
        self.assertEqual(jobs, [1])
        with use_operator():
            self.assertIsNone(Subscription.objects.get(pk=self.subscription.pk).issuance_request_id)
            self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())
            self.assertFalse(ShareIssuanceExecution.objects.filter(source_instruction=proposal).exists())
            self.assertFalse(RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply").exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE args->>'subscription_uuid'=%s",
                    [str(self.subscription.pk)],
                )
                self.assertEqual(cursor.fetchone()[0], 0)
        applied, _ = self.paid_decide(proposal, "apply")
        self.assertEqual(self.execute_paid_issue(applied)["status"], "executed")

    def test_actual_queue_failure_rolls_back_the_exact_paid_application(self):
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        with patch(
            "tokens.services.issuance_execution._enqueue", side_effect=RuntimeError("Synthetic queue outage")
        ), self.assertRaises(RuntimeError):
            self.paid_decide(proposal, "apply")
        with use_operator():
            self.assertIsNone(Subscription.objects.get(pk=self.subscription.pk).issuance_request_id)
            self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())
            self.assertFalse(RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply").exists())
        self.paid_decide(proposal, "apply")

    def test_unsigned_common_signer_wait_holds_original_paid_source_before_outgoing(self):
        from blockchain.models import OutgoingOperation, SigningAccount
        from tokens.services import issuance_execution

        proposal = self.applied_paid_issue()
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            execution = issuance_execution._start(execution)
            claim = issuance_execution._claim(execution)
            execution.refresh_from_db()
            operation = OutgoingOperation.objects.get(pk=claim.operation_id)
            signer = SigningAccount.objects.get(
                address__iexact=execution.intent["sender"], chain_id=execution.intent["chain_id"]
            )
        result = self.while_row_is_held(
            lambda: self.execute_paid_issue(proposal),
            signer,
            held=(self.company, self.token, self.offer, self.subscription, proposal, execution, operation),
        )
        self.assertEqual(result["status"], "executed")

    def test_default_deferred_preparation_expiry_removes_source_and_copied_file_without_admission(self):
        actor, _, appointment = self.appointee(
            uuid4().hex, ["prepare"], expires_at=timezone.now() + timedelta(seconds=3)
        )
        payload = self.paid_payload(actor=actor, appointment=appointment)
        original, retained = RegisterInstruction.save, []

        def delay(source, *args, **kwargs):
            value = original(source, *args, **kwargs)
            if source.pk == payload["operation_id"]:
                retained.append((source.file.storage, source.file.name))
                self._wait_until(appointment.expires_at)
            return value

        with patch.object(RegisterInstruction, "save", new=delay), self.assertRaises(RegisterChangeConflict):
            prepare_paid_issue(**payload)
        with use_operator():
            self.assertFalse(RegisterInstruction.objects.filter(pk=payload["operation_id"]).exists())
            self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())
        self.assertEqual(len(retained), 1)
        self.assertFalse(retained[0][0].exists(retained[0][1]))
        self.assertEqual(self.prepare_paid_issue().status, "submitted")

    def test_default_deferred_signature_expiry_keeps_original_unsigned_claim_and_nonce(self):
        from blockchain.models import SigningAccount
        from tokens.services import issuance_execution

        actor, _, appointment = self.appointee(uuid4().hex, ["apply"], expires_at=timezone.now() + timedelta(seconds=3))
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        applied, _ = self.paid_decide(proposal, "apply", actor=actor, appointment=appointment.pk)
        original = issuance_execution._record_signed

        def delay(*args):
            original(*args)
            self._wait_until(appointment.expires_at)

        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
        with patch("tokens.services.issuance_execution._record_signed", side_effect=delay):
            self.assertEqual(self.execute_paid_issue(applied)["status"], "executing")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(execution.operation.status, "preparing")
            self.assertIsNone(execution.transaction_id)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        self.assertEqual(self.issuance_node.broadcasts, [])
        self.assertEqual(self.execute_paid_issue(applied)["status"], "failed")

    def test_busy_original_source_rows_defer_same_claim_without_attempt_then_recover(self):
        from blockchain.models import SigningAccount

        proposal = self.applied_paid_issue()
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
            profile = UserProfile.objects.get(user=self.owner)
        for row in (self.wallet, self.account, self.owner, profile, self.token):
            started, release = Event(), Event()

            def hold():
                connections.close_all()
                try:
                    with use_operator(), atomic():
                        type(row).objects.select_for_update().get(pk=row.pk)
                        started.set()
                        self.assertTrue(release.wait(10))
                finally:
                    connections.close_all()

            with ThreadPoolExecutor(max_workers=1) as pool:
                worker = pool.submit(hold)
                self.assertTrue(started.wait(5))
                try:
                    self.assertEqual(self.execute_paid_issue(proposal)["status"], "executing")
                    with use_operator():
                        execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
                        self.assertEqual(execution.operation.status, "preparing")
                        self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
                        self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
                finally:
                    release.set()
                    worker.result(timeout=10)
        self.assertEqual(self.execute_paid_issue(proposal)["status"], "executed")

    def test_temporary_provider_hold_preserves_claim_but_definite_gas_failure_keeps_original_retry(self):
        from blockchain.models import SigningAccount
        from tokens.services import issuance_execution

        proposal = self.applied_paid_issue()
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
        with patch.object(
            self.issuance_node.client, "estimate_gas", side_effect=ConnectionError("Synthetic provider unavailable")
        ):
            self.assertEqual(self.execute_paid_issue(proposal)["status"], "executing")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            original = execution.operation_id, execution.operation.claim_id
            self.assertEqual(execution.operation.status, "preparing")
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        with patch.object(
            self.issuance_node.client, "estimate_gas", side_effect=ValueError("Synthetic deterministic revert")
        ):
            self.assertEqual(self.execute_paid_issue(proposal)["status"], "failed")
        with use_operator():
            execution.refresh_from_db()
            self.assertEqual((execution.operation_id, execution.operation.claim_id), original)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
            issuance_execution.admit(
                request,
                self.technical,
                subscription=self.subscription,
                confirmed=issuance_execution.confirmation(request, self.technical, subscription=self.subscription),
            )
        self.assertEqual(self.execute_paid_issue(proposal)["status"], "executed")

    def test_new_paid_coverage_is_refused_for_both_subscription_and_executed_request_references(self):
        from tokens.services.register_instructions import submit_instruction

        proposal = self.applied_paid_issue()
        self.assertEqual(self.execute_paid_issue(proposal)["status"], "executed")
        for reference in ({"subscription": str(self.subscription.pk)}, {"request": str(proposal.request_id)}):
            item = reference | {"recipient": self.wallet.address, "amount": "25"}
            with use_operator(), self.assertRaises(PermissionDenied):
                submit_instruction(
                    actor=self.owner,
                    operation_id=uuid4(),
                    token_id=self.token.pk,
                    document_id=uuid4(),
                    kind="issue",
                    items=[item],
                    approving_director="Synthetic Director",
                    authority_reference="Do not renew old paid coverage",
                    reason="Already executed paid request",
                )
            with self.database_role("operator", self.owner), self.assertRaises(DatabaseError), atomic():
                RegisterInstruction.objects.create(
                    company=self.company,
                    token=self.token,
                    kind="issue",
                    items=[item],
                    approving_director="Synthetic Director",
                    authority_reference="UNBOUND-PAID-COVER",
                    reason="No company issue mandate",
                    submitted_by=self.owner,
                )
        with use_operator():
            self.assertEqual(RegisterInstruction.objects.company_paid_issues().filter(token=self.token).count(), 1)
            self.assertEqual(RegisterEntry.objects.filter(register__token=self.token, kind="issue").count(), 1)

    def test_current_paid_task_binds_plain_original_applier_and_restores_requester_context(self):
        from offerings.tasks import allot_subscription_task

        proposal = self.applied_paid_issue()
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
        payload = {"subscription_uuid": str(self.subscription.pk), "execution_id": str(execution.pk)}
        with patch("tokens.services.issuance_execution.recover") as recover:
            for actor in (True, str(self.owner.pk), float(self.owner.pk), None, self.technical.pk):
                self.assertFalse(allot_subscription_task.func(**payload, executed_by=actor)["success"])
            recover.assert_not_called()
        previous = current_alias()
        with acting_for(self.participant.pk):
            result = allot_subscription_task.func(**payload, executed_by=self.owner.pk)
            self.assertEqual(current_alias(), previous)
            self.assertEqual(principal_of(previous), str(self.participant.pk))
        self.assertTrue(result["success"], result)
        with use_operator():
            execution.refresh_from_db()
            self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).status, "allotted")
            self.assertEqual(
                RegisterEntry.objects.get(operation_id=execution.issuance_id).recorded_by_id, self.owner.pk
            )


class RegisterPaidIssueMetadataChecks(CompanyEligibilityConsumptionCases, StubUploadDependencies):
    def setUp(self):
        self.enterContext(override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID))
        self.enterContext(patch("eth_account.Account.sign_transaction", side_effect=AssertionError("No signing")))
        super().setUp()
        self.accepted()
        self.technical = subscription_technical_actor()
        self.company = update_company(self.company, {"is_open_to_investors": True}, actor=self.owner)
        with use_operator():
            configure_operator()
            self.wallet = Wallet.objects.create(
                user_account=self.account,
                address="0x" + "2" * 40,
                chain="base",
                verification_status="VERIFIED",
                verified_at=timezone.now(),
            )
            self.token = ShareToken.objects.create(
                company=self.company,
                name="Unsigned metadata validation",
                symbol="META",
                total_supply="100",
                status="deployed",
                chain="base",
                contract_address="0x" + "3" * 40,
            )
            self.offer = Offering.objects.create(
                token=self.token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=Decimal("2.50"),
                minimum_shares=1,
                target_shares=100,
                cap_shares=100,
                maximum_shares=100,
                opens_at=timezone.now(),
                summary="Synthetic unsigned paid metadata validation",
            )
            submit_offering(self.offer, submitted_by=self.owner)
            transition_offering(self.offer, "approve", reviewed_by=self.technical)
            self.offer.refresh_from_db()
        self.enterContext(patch("tokens.services.register_paid_issues.chain_snapshot", return_value=(100, 0, 0)))
        self.subscription = CompanyPaidIssueCases.genuine_paid_subscription(self)

    def test_paid_readiness_and_preparation_reject_invalid_metadata_without_any_execution(self):
        proposal = prepare_paid_issue(**CompanyPaidIssueCases.paid_payload(self))
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT to_jsonb(source) FROM tokens_registerinstruction source WHERE uuid=%s", [proposal.pk]
            )
            original = json.loads(cursor.fetchone()[0])
        cases = ("calldata", "chain", "sender", "snapshot", "file_company", "file_source")
        for case in cases:
            with self.subTest(case=case):
                metadata = deepcopy(original)
                metadata["uuid"] = str(uuid4())
                metadata["snapshot"]["private"].update(request=str(uuid4()), dispatch=str(uuid4()))
                metadata["file"] = f"companies/{self.company.pk}/register-instructions/{metadata['uuid']}/{uuid4()}.bin"
                if case in ("calldata", "chain", "sender"):
                    field, value = {
                        "calldata": ("data", "0x"),
                        "chain": ("chain_id", 8453),
                        "sender": ("sender", "invalid"),
                    }[case]
                    metadata["intent"][field] = value
                    metadata["snapshot"]["transaction"][field] = value
                elif case == "snapshot":
                    metadata["snapshot"]["transaction"]["data"] = "0x"
                elif case == "file_company":
                    metadata["file"] = f"companies/{uuid4()}/register-instructions/{metadata['uuid']}/{uuid4()}.bin"
                else:
                    metadata["file"] = f"companies/{self.company.pk}/register-instructions/{uuid4()}/{uuid4()}.bin"
                with self.database_role("operator", self.owner):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')",
                            [json.dumps(metadata["intent"])],
                        )
                        metadata["intent_digest"] = cursor.fetchone()[0]
                        cursor.execute(
                            "SELECT tokens_register_paid_issue_ready("
                            "jsonb_populate_record(NULL::tokens_registerinstruction,%s::jsonb))",
                            [json.dumps(metadata)],
                        )
                        self.assertFalse(cursor.fetchone()[0])
                    with company_operation(
                        self.owner, self.company.pk, "register_paid_issue_prepare"
                    ), self.assertRaises(DatabaseError) as refused, atomic():
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute(
                                "INSERT INTO tokens_registerinstruction SELECT populated.* FROM "
                                "jsonb_populate_record(NULL::tokens_registerinstruction,%s::jsonb) populated",
                                [json.dumps(metadata)],
                            )
                    self.assertEqual(getattr(refused.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertEqual(RegisterInstruction.objects.company_paid_issues().filter(token=self.token).count(), 1)
            self.assertFalse(RegisterInstructionDecision.objects.filter(instruction=proposal).exists())
            for model in (
                SigningAccount,
                SignedAttempt,
                OutgoingOperation,
                ShareIssuanceRequest,
                ShareIssuanceExecution,
                RegisterEntry,
            ):
                self.assertFalse(model.objects.exists(), model.__name__)


class RegisterPaidIssueMetadataTest(RegisterPaidIssueMetadataChecks, APITransactionTestCase):
    pass
