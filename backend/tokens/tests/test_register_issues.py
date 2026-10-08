from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from blockchain.models import SignedAttempt, SigningAccount
from companies.services.team import revoke_company_appointment
from offerings.models import Subscription
from shared.db import (
    acting_for,
    atomic,
    current_alias,
    use_app,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterInstruction,
    RegisterInstructionDecision,
    RegisterPosition,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
)
from tokens.services import issuance_execution
from tokens.services.register_issues import (
    ISSUES,
    _allocations,
    decide_issue,
    prepare_issue,
)
from tokens.services.register_transfers import register_members
from tokens.tasks import execute_review_request_task
from tokens.tests.company_issue_fixtures import CompanyIssueCases


class RegisterIssuesTest(CompanyIssueCases, APITransactionTestCase):
    def test_a_genuine_zero_chain_opening_link_and_company_grant_admit_without_a_paid_receipt(self):
        with use_operator():
            selected = next(row for row in register_members(self.token)["members"] if row["member"] == self.member)
            self.assertEqual((selected["current_shares"], selected["walletless"]), ("0", False))
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 0)
            self.assertFalse(ShareIssuance.objects.filter(token=self.token).exists())
        proposal = self.applied_issue()
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(
                (execution.request_id, execution.executed_by_id, execution.authority),
                (proposal.request_id, self.owner.pk, "company"),
            )
            self.assertFalse(Subscription.objects.filter(issuance_request_id=proposal.request_id).exists())
            self.assertFalse(RegisterEntry.objects.filter(register__token=self.token, kind="issue").exists())
            self.assertEqual(_allocations(self.token, uuid4())[2], 25)

    def test_the_original_mint_is_recorded_once_for_the_frozen_member_after_finality(self):
        proposal = self.applied_issue()
        result = self.execute_issue(proposal)
        self.assertEqual(result["status"], "executed")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            entry = RegisterEntry.objects.get(operation_id=execution.issuance_id, kind="issue")
            self.assertEqual(entry.changes, [{"member": str(self.member), "shares": "25"}])
            self.assertEqual(entry.recorded_by_id, self.owner.pk)
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 25)
            self.assertEqual(RegisterPosition.objects.get(register__token=self.token, member_id=self.member).shares, 25)
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)
        self.execute_issue(proposal)
        with use_operator():
            self.assertEqual(RegisterEntry.objects.filter(operation_id=execution.issuance_id).count(), 1)

    def test_exact_preparation_replay_preserves_the_original_request_and_terms(self):
        payload = self.issue_payload()
        proposal = prepare_issue(**payload)
        replay = prepare_issue(**payload)
        self.assertEqual(replay.pk, proposal.pk)
        with use_operator():
            self.assertEqual(ShareIssuanceRequest.objects.filter(token=self.token).count(), 1)
        with self.assertRaises(RegisterChangeConflict):
            prepare_issue(**{**payload, "shares": 26})

    def test_exact_applied_receipt_replay_survives_approval_lapse_with_current_read_access(self):
        approver, _, approving = self.appointee(uuid4().hex, ["approve"])
        proposal = self.prepare_issue()
        self.issue_decide(proposal, "approve", actor=approver, appointment=approving.pk)
        applied, original = self.issue_decide(proposal, "apply")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        self.assertEqual(decide_issue(**original).pk, applied.pk)
        with self.assertRaises(RegisterChangeConflict):
            decide_issue(**{**original, "reason": "Changed retained application"})
        with use_operator():
            self.assertEqual(RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply").count(), 1)
            self.assertEqual(ShareIssuanceExecution.objects.filter(source_instruction=proposal).count(), 1)

    def test_ordinary_whitespace_on_live_identity_has_the_same_retained_snapshot_at_sql_boundary(self):
        with use_operator():
            from users.models import UserProfile

            profile = UserProfile.objects.get(user=self.participant)
            name, address = profile.full_name.strip(), profile.residential_address.strip()
            profile.full_name, profile.residential_address = "\t " + name + " \t", "\t " + address + " \t"
            profile.save(update_fields=["full_name", "residential_address"])
        proposal = self.applied_issue()
        self.assertEqual(proposal.snapshot["member"]["name"], name)
        self.assertEqual(proposal.snapshot["member"]["residential_address"], address)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")

    def test_two_75_share_commands_reserve_whole_headroom_before_any_chain_effect(self):
        first, second = self.prepare_issue(shares=75), self.prepare_issue(shares=75)
        self.issue_decide(first, "approve")
        self.issue_decide(second, "approve")
        self.issue_decide(first, "apply")
        preview = self.issue_preview(second)
        self.assertEqual((preview["reserved_shares"], preview["available_shares"]), ("75", "25"))
        self.assertIn("insufficient_headroom", preview["unmet_requirements"])
        with self.assertRaises(ValidationError):
            self.issue_decide(second, "apply")
        with use_operator():
            self.assertEqual(ShareIssuanceExecution.objects.filter(token_id=self.token.pk).count(), 1)

    def test_the_company_can_reject_a_prepared_request_without_a_wallet_effect(self):
        proposal = self.prepare_issue()
        rejected, _ = self.issue_decide(proposal, "reject", reason="Company declined this grant")
        with use_operator():
            request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
            self.assertEqual(
                (rejected.status, request.status, request.rejection_reason),
                ("rejected", "rejected", rejected.rejection_reason),
            )
            self.assertFalse(ShareIssuanceExecution.objects.filter(request_id=request.pk).exists())
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)

    def test_frozen_company_request_terms_refuse_raw_app_retargeting_before_approval(self):
        proposal = self.prepare_issue()
        with use_app(), acting_for(self.owner.pk):
            active_connection = connections[current_alias()]
            with active_connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role')")
                previous = cursor.fetchone()[0]
                cursor.execute(f"SET ROLE {active_connection.ops.quote_name(settings.RLS_ROLES['app'])}")
            try:
                for changes in ({"amount": 99}, {"recipient_address": "0x" + "11" * 20}):
                    with self.assertRaises(DatabaseError), atomic():
                        ShareIssuanceRequest.objects.filter(pk=proposal.request_id).update(**changes)
            finally:
                with active_connection.cursor() as cursor:
                    cursor.execute(
                        "RESET ROLE" if previous == "none" else f"SET ROLE {active_connection.ops.quote_name(previous)}"
                    )
        self.issue_decide(proposal, "approve")
        self.assertEqual(self.issue_decide(proposal, "apply")[0].status, "applied")

    def test_executed_but_unentered_mint_reserves_headroom_and_recovers_exactly_once(self):
        proposal = self.applied_issue()
        with patch("tokens.services.issuance_execution.record_completed_effects", return_value=[]):
            self.assertEqual(self.execute_issue(proposal)["status"], "executed")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertFalse(RegisterEntry.objects.filter(operation_id=execution.issuance_id).exists())
            self.assertEqual(_allocations(self.token, uuid4())[2], 25)
            attempts = SignedAttempt.objects.filter(operation_id=execution.operation_id).count()
        with self.assertRaises(ValidationError):
            self.prepare_issue(shares=90)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")
        with use_operator():
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)
            self.assertEqual(RegisterEntry.objects.filter(operation_id=execution.issuance_id).count(), 1)
            self.assertEqual(SignedAttempt.objects.filter(operation_id=execution.operation_id).count(), attempts)

    def test_genuine_paid_unentered_outcome_is_recovered_after_a_post_commit_recording_failure(self):
        from decimal import Decimal
        from types import SimpleNamespace

        from companies.services.editing import update_company
        from offerings.models import Offering
        from offerings.services.subscription import allot
        from offerings.tests.factories import (
            allottable_subscription,
            configure_operator,
            subscription_technical_actor,
        )
        from tokens.tasks import check_executing_issuance_requests

        self.company = update_company(self.company, {"is_open_to_investors": True}, actor=self.owner)
        self.token.company = self.company
        with use_operator():
            configure_operator()
            offering = Offering.objects.create(
                token=self.token,
                exemption="s708_11_professional",
                price_per_share=Decimal("2.50"),
                minimum_shares=10,
                target_shares=50,
                cap_shares=100,
                status="approved",
                opens_at=timezone.now() - timedelta(days=1),
                closes_at=timezone.now() + timedelta(days=30),
            )
            tenant = SimpleNamespace(
                user=self.participant, account=self.account, wallet=self.wallet, company=self.company, offering=offering
            )
            subscription = allottable_subscription(tenant, quantity=10)
            actor = subscription_technical_actor()
            request = allot(subscription, actor, headroom=(100, 100))
            command = ShareIssuanceExecution.objects.get(pk=request.dispatch_id)
            self.assertIsNone(command.source_instruction_id)
            with patch(
                "tokens.services.issuance_execution.record_completed_effects",
                side_effect=DatabaseError("Synthetic post-commit recording outage"),
            ):
                with self.assertRaises(DatabaseError):
                    issuance_execution.recover(command.pk)
            command.refresh_from_db()
            self.assertEqual(command.status, "executed")
            self.assertFalse(RegisterEntry.objects.filter(operation_id=command.issuance_id).exists())
            self.assertEqual(_allocations(self.token, uuid4())[2], 10)
            attempt = SignedAttempt.objects.get(operation_id=command.operation_id)
            self.assertIn(
                command.pk, ShareIssuanceExecution.objects.recoverable(timezone.now()).values_list("pk", flat=True)
            )
            self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 1})
            self.assertEqual(RegisterEntry.objects.filter(operation_id=command.issuance_id).count(), 1)
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)
            self.assertEqual(RegisterPosition.objects.get(register__token=self.token, member_id=self.member).shares, 10)
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
            self.assertEqual(SignedAttempt.objects.get(operation_id=command.operation_id).pk, attempt.pk)
            self.assertNotIn(
                command.pk, ShareIssuanceExecution.objects.recoverable(timezone.now()).values_list("pk", flat=True)
            )
            self.assertEqual(RegisterEntry.objects.filter(operation_id=command.issuance_id).count(), 1)

    def test_source_lapse_holds_signed_original_recovery_and_preserves_frozen_entry_identity(self):
        applier, _, applying = self.appointee(uuid4().hex, ["apply"])
        proposal = self.prepare_issue()
        self.issue_decide(proposal, "approve")
        applied, _ = self.issue_decide(proposal, "apply", actor=applier, appointment=applying.pk)
        self.issuance_node.confirmed = False
        self.assertEqual(self.execute_issue(applied)["status"], "executing")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            attempt = SignedAttempt.objects.get(operation_id=execution.operation_id)
            nonce = SigningAccount.objects.get().next_nonce
        revoke_company_appointment(requester=self.owner, appointment_id=applying.pk)
        self.issuance_node.confirmed = True
        self.assertEqual(self.execute_issue(applied)["status"], "executed")
        with use_operator():
            self.assertEqual(SignedAttempt.objects.get(operation_id=execution.operation_id).pk, attempt.pk)
            self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
            entry = RegisterEntry.objects.get(operation_id=execution.issuance_id)
            self.assertEqual(
                (entry.recorded_by_id, entry.changes), (applier.pk, [{"member": str(self.member), "shares": "25"}])
            )
            self.assertEqual(self.issuance_node.broadcasts, [bytes(attempt.raw_transaction)] * 2)

    def test_malformed_task_principals_cannot_reach_a_fresh_signature(self):
        proposal = self.applied_issue()
        with use_operator():
            execution_id = ShareIssuanceRequest.objects.get(pk=proposal.request_id).dispatch_id
        for actor in (True, str(self.owner.pk), 1.0):
            result = execute_review_request_task.func(
                model_label="tokens.ShareIssuanceRequest",
                request_uuid=str(proposal.request_id),
                execution_id=str(execution_id),
                executed_by=actor,
            )
            self.assertFalse(result["success"])
        self.issuance_node.client.send_raw_transaction.assert_not_called()
        result = execute_review_request_task.func(
            model_label="tokens.ShareIssuanceRequest",
            request_uuid=str(proposal.request_id),
            execution_id=str(execution_id),
            executed_by=self.owner.pk,
        )
        self.assertTrue(result["success"])

    def test_distinct_75_share_proposals_race_on_real_sessions_and_only_one_reserves_cap(self):
        proposals = [self.prepare_issue(shares=75), self.prepare_issue(shares=75)]
        for proposal in proposals:
            self.issue_decide(proposal, "approve")
        previews = [self.issue_preview(proposal) for proposal in proposals]
        barrier = Barrier(2)
        sessions = []

        def apply(index):
            connections.close_all()
            try:
                with use_operator():
                    active_connection = connections[current_alias()]
                    with active_connection.cursor() as cursor:
                        cursor.execute("SET lock_timeout='10s'")
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        sessions.append(cursor.fetchone())
                    barrier.wait(timeout=5)
                    try:
                        return decide_issue(
                            actor=self.owner,
                            issue_id=proposals[index].pk,
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
            futures = [pool.submit(apply, index) for index in range(2)]
            outcomes = [future.result(timeout=15) for future in futures]
        self.assertCountEqual(outcomes, ["applied", "refused"])
        self.assertEqual(len({row[0] for row in sessions}), 2)
        if isinstance(self, RunsOnTheScopedConnection):
            self.assertEqual({row[1] for row in sessions}, {settings.RLS_ROLES["operator"]})
        with use_operator():
            self.assertEqual(ShareIssuanceExecution.objects.filter(token_id=self.token.pk).count(), 1)
            self.assertEqual(_allocations(self.token, uuid4())[2], 75)
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 0)

    def test_registry_identity_ignores_another_network_at_the_exact_nominated_address(self):
        from shared.tests.tenants import make_tenant
        from wallets.models import Wallet
        from whitelist.models import WhitelistEntry

        with use_operator():
            unrelated = make_tenant("grant-other-network")
            ethereum = Wallet.objects.create(
                user_account=unrelated.account, address=self.wallet.address, chain="ethereum"
            )
            WhitelistEntry.objects.create(wallet=ethereum)
        proposal = self.applied_issue()
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT tokens_register_issue_ready(proposal) FROM tokens_registerinstruction proposal WHERE uuid=%s",
                [proposal.pk],
            )
            self.assertIs(cursor.fetchone()[0], True)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")

    def test_identical_duplicate_base_entries_are_ambiguous_at_service_and_sql_boundaries(self):
        from shared.tests.tenants import make_tenant
        from users.models import UserProfile
        from wallets.models import Wallet
        from whitelist.models import WhitelistEntry

        proposal = self.prepare_issue()
        self.issue_decide(proposal, "approve")
        with use_operator():
            unrelated = make_tenant("grant-duplicate-base")
            profile = UserProfile.objects.get(user=self.participant)
            UserProfile.objects.filter(pk=unrelated.profile.pk).update(
                full_name=profile.full_name, residential_address=profile.residential_address
            )
            duplicate = Wallet.objects.create(user_account=unrelated.account, address=self.wallet.address, chain="base")
            WhitelistEntry.objects.create(wallet=duplicate)
        preview = self.issue_preview(proposal, "apply")
        self.assertIn("member_identity_unavailable", preview["unmet_requirements"])
        with (
            patch("tokens.services.register_issues.ISSUES", replace(ISSUES, effect_requirements=lambda proposal: [])),
            self.assertRaises(RegisterChangeConflict),
        ):
            self.issue_decide(proposal, "apply")
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT tokens_register_issue_ready(proposal) FROM tokens_registerinstruction proposal WHERE uuid=%s",
                [proposal.pk],
            )
            self.assertIs(cursor.fetchone()[0], False)
            self.assertFalse(ShareIssuanceExecution.objects.filter(source_instruction=proposal).exists())
            self.assertFalse(RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply").exists())
        rejected, _ = self.issue_decide(proposal, "reject", reason="Resolve the ambiguous exact Base identity")
        self.assertEqual(rejected.status, "rejected")

    def test_distinct_failed_75_share_retries_take_the_same_cap_fence_before_outgoing_locks(self):
        from django.contrib.auth import get_user_model

        from tokens.exceptions import IssuanceExecutionConflict

        with use_operator():
            technical = get_user_model().objects.create_superuser(
                email=f"technical-{uuid4()}@example.test", password="synthetic"
            )
        proposals = []
        self.issuance_node.receipt_status = 0
        for _ in range(2):
            proposal = self.applied_issue(shares=75)
            self.assertEqual(self.execute_issue(proposal)["status"], "failed")
            proposals.append(proposal)
        with use_operator():
            confirmations = [issuance_execution.confirmation(proposal.request, technical) for proposal in proposals]
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)
        barrier = Barrier(2)
        sessions = []

        def retry(index):
            connections.close_all()
            try:
                with use_operator():
                    active_connection = connections[current_alias()]
                    with active_connection.cursor() as cursor:
                        cursor.execute("SET lock_timeout='10s'")
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        sessions.append(cursor.fetchone())
                    barrier.wait(timeout=5)
                    try:
                        return issuance_execution.admit(
                            proposals[index].request, technical, confirmed=confirmations[index]
                        ).status
                    except IssuanceExecutionConflict:
                        return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(retry, index) for index in range(2)]
            self.assertCountEqual([future.result(timeout=15) for future in futures], ["queued", "refused"])
        self.assertEqual(len({row[0] for row in sessions}), 2)
        if isinstance(self, RunsOnTheScopedConnection):
            self.assertEqual({row[1] for row in sessions}, {settings.RLS_ROLES["operator"]})
        with use_operator():
            self.assertEqual(_allocations(self.token, uuid4())[2], 75)
            self.assertEqual(ShareIssuanceExecution.objects.filter(token_id=self.token.pk, status="queued").count(), 1)
            self.assertEqual(RegisterEntry.objects.filter(register__token=self.token, kind="issue").count(), 0)

    def test_same_class_capital_and_grant_sign_token_before_the_common_signer_without_deadlock(self):
        from django.contrib.auth import get_user_model
        from eth_account.signers.local import LocalAccount

        from blockchain.services import outgoing
        from tokens.models import CapitalIncreaseRequest
        from tokens.services import capital_execution
        from tokens.services.capital_increase import submit_capital_increase
        from tokens.tests.capital_fixtures import CapitalNode, admit

        proposal = self.applied_issue()
        with use_operator():
            actor = get_user_model().objects.create_superuser(
                email="same-class-capital@example.test", password="synthetic"
            )
            request = CapitalIncreaseRequest.objects.create(
                token=self.token,
                additional_shares=10,
                new_authorized_total=110,
                purpose="Retained current capital increase",
                board_resolution_reference="SAME-CLASS-CAPITAL",
            )
            submit_capital_increase(request, self.owner)
            request.approve(actor)
            capital = admit(request, actor)
            nonce = SigningAccount.objects.get().next_nonce
        node = CapitalNode(cap=100)
        node.event_changes = {"oldAmount": 100, "newAmount": 110}
        capital_ready, release_signature, release_projection = Event(), Event(), Event()
        grant_ready = Event()
        sessions = {}
        original_local = LocalAccount.sign_transaction
        original_sign = outgoing.sign_operation

        def pause_local(account, transaction, **options):
            if transaction["data"] == capital.intent["data"]:
                capital_ready.set()
                self.assertTrue(release_signature.wait(10))
            return original_local(account, transaction, **options)

        def pause_projection(*args, **kwargs):
            attempt = original_sign(*args, **kwargs)
            if args[0].operation_id == capital.operation_id:
                self.assertTrue(release_projection.wait(10))
            return attempt

        def worker(name):
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SET statement_timeout = '15s'")
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        sessions[name] = cursor.fetchone()
                    if name == "capital":
                        return capital_execution.recover(capital.pk)
                    grant_ready.set()
                    return self.execute_issue(proposal)
            finally:
                connections.close_all()

        inspection = connections["default"].copy()
        try:
            with (
                patch("tokens.services.capital_execution.get_base_chain_client", return_value=node.client),
                patch.object(LocalAccount, "sign_transaction", pause_local),
                patch.object(outgoing, "sign_operation", pause_projection),
                ThreadPoolExecutor(max_workers=2) as pool,
            ):
                capital_future = pool.submit(worker, "capital")
                self.assertTrue(capital_ready.wait(5))
                with use_operator():
                    capital.refresh_from_db()
                grant_future = pool.submit(worker, "grant")
                try:
                    self.assertTrue(grant_ready.wait(5))
                    self.wait_for_pid(inspection, sessions["grant"][0], sessions["capital"][0])
                    with inspection.cursor() as cursor:
                        cursor.execute("SELECT query FROM pg_stat_activity WHERE pid=%s", [sessions["grant"][0]])
                        waited_query = cursor.fetchone()[0]
                    self.assert_row_lock(inspection, self.token, held=True)
                finally:
                    release_signature.set()
                try:
                    grant_result = grant_future.result(timeout=15)
                finally:
                    release_projection.set()
                capital_result = capital_future.result(timeout=15)
            self.assertNotIn("blockchain_signingaccount", waited_query)
            self.assertTrue(waited_query == "COMMIT" or "tokens_sharetoken" in waited_query, waited_query)
            self.assertEqual((grant_result["status"], capital_result["status"]), ("executed", "executed"))
            self.assertNotEqual(sessions["grant"][0], sessions["capital"][0])
            if isinstance(self, RunsOnTheScopedConnection):
                self.assertEqual({row[1] for row in sessions.values()}, {settings.RLS_ROLES["operator"]})
            with use_operator():
                grant = ShareIssuanceExecution.objects.get(source_instruction=proposal)
                attempts = SignedAttempt.objects.filter(operation_id__in=[capital.operation_id, grant.operation_id])
                self.assertEqual(sorted(attempts.values_list("nonce", flat=True)), [nonce, nonce + 1])
                self.assertEqual(SigningAccount.objects.get().next_nonce, nonce + 2)
                self.token.refresh_from_db()
                self.assertEqual(self.token.total_supply, "110")
                self.assertEqual(RegisterEntry.objects.filter(operation_id=grant.issuance_id).count(), 1)
                self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 25)
        finally:
            release_signature.set()
            release_projection.set()
            inspection.close()

    def test_required_acceptance_wrong_evidence_and_non_recipient_director_are_current_guards(self):
        from tokens.models import RegisterEvidenceKind
        from tokens.tests.evidence_fixtures import upload_evidence
        from users.models import UserProfile

        with use_operator():
            profile = UserProfile.objects.get(user=self.participant)
            name = profile.full_name
        for changes in (
            {"acceptance_required": True},
            {"acceptance_required": False, "acceptance_evidence": uuid4()},
            {"approving_director": "\t" + name.upper() + "\t"},
            {"shares": "1.5"},
            {"shares": 0},
            {"member": uuid4()},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.prepare_issue(**changes)
        acceptance = upload_evidence(self.owner, self.initial, RegisterEvidenceKind.SUPPORTING)
        proposal = self.applied_issue(acceptance_required=True, acceptance_evidence=acceptance.pk)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")

    def test_a_replaced_proof_terminalises_only_the_original_never_signed_operation(self):
        proposal = self.applied_issue()
        self.prove_wallet()
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
        self.assertEqual(self.execute_issue(proposal)["status"], "failed")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(execution.operation.status, "failed")
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)
        self.assertEqual(self.issuance_node.broadcasts, [])

    def test_genuine_wallet_deletion_releases_only_a_never_signed_original_allocation(self):
        from wallets.services.registration import delete_wallet

        proposal = self.applied_issue()
        with acting_for(self.participant.pk):
            delete_wallet(self.participant, self.wallet.pk)
        self.assertEqual(self.execute_issue(proposal)["status"], "failed")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(execution.operation.status, "failed")
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)
            self.assertFalse(RegisterEntry.objects.filter(operation_id=execution.issuance_id).exists())
        self.assertEqual(self.issuance_node.broadcasts, [])

    def test_temporary_provider_failure_preserves_original_unsigned_work_and_headroom(self):
        proposal = self.applied_issue()
        with patch(
            "blockchain.services.outgoing.prepare_operation", side_effect=ConnectionError("Synthetic provider outage")
        ):
            self.assertEqual(self.execute_issue(proposal)["status"], "executing")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(execution.operation.status, "preparing")
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(_allocations(self.token, uuid4())[2], 25)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")

    def _wait_until(self, expires_at):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz - clock_timestamp()))) + 0.05)",
                [expires_at],
            )

    def test_default_deferred_preparation_expiry_rolls_back_frozen_request_source_and_files(self):
        preparer, _, preparing = self.appointee(
            uuid4().hex, ["prepare"], expires_at=timezone.now() + timedelta(seconds=3)
        )
        payload = self.issue_payload(actor=preparer, appointment=preparing)
        original = RegisterInstruction.save
        retained = []

        def delay(proposal, *args, **kwargs):
            result = original(proposal, *args, **kwargs)
            if proposal.preparing_appointment_id == preparing.pk:
                retained.extend(
                    (field.storage, field.name) for field in (proposal.file, proposal.terms_file) if field.name
                )
                self._wait_until(preparing.expires_at)
            return result

        with patch.object(RegisterInstruction, "save", new=delay), self.assertRaises(RegisterChangeConflict):
            prepare_issue(**payload)
        with use_operator():
            self.assertFalse(RegisterInstruction.objects.filter(pk=payload["operation_id"]).exists())
            self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token).exists())
            self.assertFalse(ShareIssuanceExecution.objects.filter(token_id=self.token.pk).exists())
        self.assertEqual(len(retained), 2)
        for storage, name in retained:
            self.assertFalse(storage.exists(name))
        self.assertEqual(self.prepare_issue().status, "submitted")

    def test_raw_staff_approval_cannot_commit_without_exact_company_or_paid_source(self):
        with use_operator():
            request = ShareIssuanceRequest.objects.create(
                token=self.token,
                recipient_address=self.wallet.address,
                amount=10,
                reason="Unbound staff request",
                submitted_by=self.owner,
            )
        with self.actual_operator(), acting_for(self.owner.pk), self.assertRaises(DatabaseError), atomic():
            request.approve(self.owner)
        with use_operator():
            request.refresh_from_db()
            self.assertEqual((request.status, request.reviewed_by_id), ("submitted", None))
            self.assertFalse(ShareIssuanceExecution.objects.filter(request_id=request.pk).exists())
        self.assertEqual(self.applied_issue().status, "applied")

    def test_default_deferred_application_expiry_rolls_back_execution_request_and_real_queue(self):
        applier, _, applying = self.appointee(uuid4().hex, ["apply"], expires_at=timezone.now() + timedelta(seconds=3))
        proposal = self.prepare_issue()
        self.issue_decide(proposal, "approve")
        preview = self.issue_preview(proposal, actor=applier, appointment=applying.pk)

        def delay(*args):
            ISSUES.apply(*args)
            observer = connections[current_alias()].copy(alias="issue_queue_observer")
            try:
                with observer.cursor() as cursor:
                    cursor.execute(
                        "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'request_uuid'=%s",
                        [execute_review_request_task.name, str(proposal.request_id)],
                    )
                    self.assertEqual(cursor.fetchone()[0], 0)
            finally:
                observer.close()
            self._wait_until(applying.expires_at)

        with (
            patch("tokens.services.register_issues.ISSUES", replace(ISSUES, apply=delay)),
            self.assertRaises(RegisterChangeConflict),
        ):
            decide_issue(
                actor=applier,
                issue_id=proposal.pk,
                appointment=applying.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        with use_operator():
            self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=proposal.request_id).status, "under_review")
            self.assertFalse(ShareIssuanceExecution.objects.filter(request_id=proposal.request_id).exists())
            self.assertFalse(RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply").exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'request_uuid'=%s",
                    [execute_review_request_task.name, str(proposal.request_id)],
                )
                self.assertEqual(cursor.fetchone()[0], 0)
        self.assertEqual(self.issue_decide(proposal, "apply")[0].status, "applied")

    def test_default_deferred_signature_expiry_rolls_back_attempt_nonce_and_public_transaction(self):
        applier, _, applying = self.appointee(uuid4().hex, ["apply"], expires_at=timezone.now() + timedelta(seconds=3))
        proposal = self.prepare_issue()
        self.issue_decide(proposal, "approve")
        applied, _ = self.issue_decide(proposal, "apply", actor=applier, appointment=applying.pk)
        original = issuance_execution._record_signed

        def delay(*args):
            original(*args)
            self._wait_until(applying.expires_at)

        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
        with patch("tokens.services.issuance_execution._record_signed", side_effect=delay):
            self.assertEqual(self.execute_issue(applied)["status"], "executing")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            self.assertEqual(execution.operation.status, "preparing")
            self.assertIsNone(execution.transaction_id)
            self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
        self.assertEqual(self.issuance_node.broadcasts, [])
        self.assertEqual(self.execute_issue(applied)["status"], "failed")
        with use_operator():
            self.assertEqual(_allocations(self.token, uuid4())[2], 0)

    def test_temporary_source_wallet_contention_keeps_original_unsigned_claim_and_nonce(self):
        proposal = self.applied_issue()
        with use_operator():
            nonce = SigningAccount.objects.get().next_nonce
        started, release = Event(), Event()

        def holder():
            connections.close_all()
            try:
                with use_operator(), atomic():
                    type(self.wallet).objects.select_for_update().get(pk=self.wallet.pk)
                    started.set()
                    self.assertTrue(release.wait(10))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(holder)
            self.assertTrue(started.wait(5))
            try:
                self.assertEqual(self.execute_issue(proposal)["status"], "executing")
                with use_operator():
                    execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
                    self.assertEqual(execution.operation.status, "preparing")
                    self.assertIsNone(execution.transaction_id)
                    self.assertFalse(SignedAttempt.objects.filter(operation_id=execution.operation_id).exists())
                    self.assertEqual(SigningAccount.objects.get().next_nonce, nonce)
                    original_claim = execution.operation.claim_id
            finally:
                release.set()
            future.result(timeout=10)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")
        with use_operator():
            execution.refresh_from_db()
            self.assertEqual(execution.operation.claim_id, original_claim)


class ScopedRegisterIssuesTest(RunsOnTheScopedConnection, RegisterIssuesTest):
    pass
