from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date, timedelta
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from companies.models import Company, CompanyStatus
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from shared.db import acting_for, atomic, current_alias, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.exceptions import IssuanceExecutionConflict, RegisterChangeConflict
from tokens.models import (
    RegisterDeployment,
    RegisterDeploymentDecision,
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterMember,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
    TokenDeployment,
)
from tokens.services import deployment, issuance_execution
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction,
    preview_correction_decision,
)
from tokens.services.register_deployments import (
    decide_deployment,
    prepare_deployment,
    preview_deployment_decision,
    queue_deployment,
)
from tokens.services.register_events import open_register
from tokens.services.register_grants import (
    decide_grant,
    prepare_grant,
    preview_grant_decision,
)
from tokens.tasks import deploy_share_token_task
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    DeploymentNode,
    admitted_signer,
)
from tokens.tests.evidence_fixtures import owner_appointment, upload_evidence
from tokens.tests.test_register_corrections import correction_payload
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import decide as decide_import
from tokens.tests.test_register_imports import import_payload
from tokens.tests.test_register_imports import prepared as prepared_import
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

DEPLOYMENTS = "/api/v1/tokens/register-deployments/"


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class RegisterDeploymentsTest(RealRowContention, AppointsTeam, StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.tenant = make_tenant("company-deployment")
            self.actor = self.tenant.user
            self.token = self.tenant.token
            with use_migrate():
                Company.objects.filter(pk=self.token.company_id).update(status=CompanyStatus.ACTIVE)
            self.token.company.refresh_from_db()
            self.appointment = owner_appointment(self.token.company)
            self.company, self.owner, self.administrator = self.token.company, self.actor, self.appointment
        self.node = DeploymentNode()
        for name in (
            "tokens.services.deployment.get_base_chain_client",
            "tokens.services.share_token_service.get_base_chain_client",
        ):
            self.enterContext(patch(name, return_value=self.node.client))
        self.real_defer = queue_deployment
        self.queue = self.enterContext(patch("tokens.services.register_deployments.queue_deployment"))
        self.client = APIClient()
        self.client.force_authenticate(self.actor)

    def prepare(self, operation_id=None):
        return prepare_deployment(
            actor=self.actor, operation_id=operation_id or uuid4(), appointment=self.appointment.pk, token=self.token.pk
        )

    def decide(self, proposal, kind, **changes):
        _, preview = preview_deployment_decision(
            actor=self.actor, deployment_id=proposal.pk, appointment=self.appointment.pk, kind=kind
        )
        values = dict(
            actor=self.actor,
            deployment_id=proposal.pk,
            appointment=self.appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
        values.update(changes)
        return decide_deployment(**values), values

    def applied(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        proposal, values = self.decide(proposal, "apply")
        with use_operator():
            self.token.refresh_from_db()
        return proposal, values

    def execute(self, principal=None):
        with use_operator():
            self.token.refresh_from_db()
            if not SigningAccount.objects.exists():
                admitted_signer()
            return deploy_share_token_task.func(
                token_uuid=str(self.token.pk),
                deployment_id=str(self.token.deployment_id),
                principal_id=self.actor.pk if principal is None else principal,
            )

    def test_api_retains_bounded_snapshot_and_admission_is_separate_from_execution(self):
        response = self.client.post(
            DEPLOYMENTS,
            {"operationId": str(uuid4()), "appointment": str(self.appointment.pk), "token": str(self.token.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        record = response.json()
        self.assertEqual(record["operationId"], record["uuid"])
        self.assertEqual(set(record["snapshot"]["issuerWallet"]), {"address", "chain"})
        self.assertEqual(set(record["snapshot"]["company"]), {"uuid", "name", "acn", "status"})
        self.assertIsNone(record["deploymentId"])
        self.assertFalse(record["snapshot"]["register"]["present"])
        with use_operator():
            proposal = RegisterDeployment.objects.get(pk=record["uuid"])
        self.decide(proposal, "approve")
        proposal, _ = self.decide(proposal, "apply")
        admitted = self.client.get(f"{DEPLOYMENTS}{proposal.pk}/").json()
        self.assertEqual(admitted["status"], "applied")
        self.assertIsNotNone(admitted["deploymentId"])
        self.assertIsNone(admitted["execution"])
        self.queue.assert_called_once_with(
            token_uuid=str(self.token.pk), deployment_id=str(proposal.deployment_id), principal_id=self.actor.pk
        )
        self.assertTrue(self.execute()["success"])
        completed = self.client.get(f"{DEPLOYMENTS}{proposal.pk}/").json()
        self.assertEqual(completed["execution"]["operationStatus"], "confirmed")
        self.assertIsNotNone(completed["execution"]["txHash"])

    def test_exact_replay_keeps_original_approval_deployment_and_snapshot_after_projection(self):
        proposal, values = self.applied()
        self.assertTrue(self.execute()["success"])
        repeated = decide_deployment(**values)
        prepared = self.prepare(proposal.pk)
        self.assertEqual(
            (repeated.deployment_id, prepared.snapshot, repeated.approval_decision_id),
            (proposal.deployment_id, proposal.snapshot, proposal.approval_decision_id),
        )
        with self.assertRaises(RegisterChangeConflict):
            decide_deployment(**(values | {"reason": "changed"}))
        self.queue.assert_called_once()

    def test_populated_unknown_and_initialized_zero_registers_are_distinct(self):
        with use_operator():
            register = ShareRegister.objects.create(token=self.token, company_id=self.token.company_id)
        with self.assertRaises(ValidationError) as error:
            self.prepare()
        self.assertIn("register_uninitialized", error.exception.detail["unmet_requirements"])
        with use_operator():
            entry = open_register(
                token_id=self.token.pk,
                operation_id=uuid4(),
                changes=[],
                effective_on=date.today(),
                recorded_by=self.actor,
            )
            register.refresh_from_db()
        proposal, _ = self.applied()
        self.assertTrue(proposal.snapshot["register"]["initialized"])
        self.assertEqual(proposal.snapshot["register"]["issued_supply"], "0")
        self.assertTrue(self.execute()["success"])
        with use_operator():
            register.refresh_from_db()
            self.assertEqual((register.sequence, register.head_hash), (1, entry.entry_hash))

    def test_positive_register_supply_refuses_empty_deployment_without_altering_history(self):
        with use_operator():
            member = RegisterMember.objects.create(company=self.company)
            entry = open_register(
                token_id=self.token.pk,
                operation_id=uuid4(),
                changes=[{"member": str(member.pk), "shares": "100"}],
                effective_on=date.today(),
                recorded_by=self.actor,
            )
        with self.assertRaises(ValidationError) as error:
            self.prepare()
        self.assertIn("register_not_empty", error.exception.detail["unmet_requirements"])
        with use_operator():
            register = ShareRegister.objects.get(token=self.token)
            self.assertEqual(
                (register.sequence, register.issued_supply, register.head_hash), (1, 100, entry.entry_hash)
            )
            self.assertFalse(RegisterDeployment.objects.exists())
        self.queue.assert_not_called()

    def test_narrow_personal_capabilities_admit_and_worker_executes_the_original_applier(self):
        preparer, preparing = self.appoint(["prepare"])
        approver, approving = self.appoint(["approve"])
        applier, applying = self.appoint(["apply"])
        proposal = prepare_deployment(
            actor=preparer, operation_id=uuid4(), appointment=preparing.pk, token=self.token.pk
        )
        for actor, appointment, kind in ((approver, approving, "approve"), (applier, applying, "apply")):
            _, preview = preview_deployment_decision(
                actor=actor, deployment_id=proposal.pk, appointment=appointment.pk, kind=kind
            )
            self.assertEqual(preview["unmet_requirements"], [])
            decide_deployment(
                actor=actor,
                deployment_id=proposal.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        with use_operator():
            self.token.refresh_from_db()
            admitted_signer()
            result = deploy_share_token_task.func(
                token_uuid=str(self.token.pk), deployment_id=str(self.token.deployment_id), principal_id=applier.pk
            )
            self.assertTrue(result["success"])
            self.assertEqual(TokenDeployment.objects.get().principal_id, applier.pk)

    def test_original_expired_apply_receipt_replays_under_another_current_read_appointment(self):
        applier, applying = self.appoint(["apply"], expires_at=timezone.now() + timedelta(seconds=5))
        proposal = self.prepare()
        self.decide(proposal, "approve")
        _, prepared = preview_deployment_decision(
            actor=applier, deployment_id=proposal.pk, appointment=applying.pk, kind="apply"
        )
        values = dict(
            actor=applier,
            deployment_id=proposal.pk,
            appointment=applying.pk,
            kind="apply",
            idempotency_key=uuid4(),
            preview_digest=prepared["preview_digest"],
            confirmation=True,
        )
        original = decide_deployment(**values)
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz - clock_timestamp()))) + 0.05)",
                [applying.expires_at],
            )
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.administrator.pk,
            idempotency_key=uuid4(),
            capabilities=["prepare"],
            delegatable_capabilities=[],
        )
        accept_team_invitation(
            requester=applier, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        self.assertEqual(decide_deployment(**values).deployment_id, original.deployment_id)
        with self.assertRaises(RegisterChangeConflict):
            decide_deployment(**(values | {"preview_digest": "f" * 64}))
        self.queue.assert_called_once()

    def test_captured_wallet_account_and_distinct_decision_actor_contention_retains_one_original_attempt(self):
        approver, approving = self.appoint(["approve"])
        applier, applying = self.appoint(["apply"])
        proposal = self.prepare()
        for actor, appointment, kind in ((approver, approving, "approve"), (applier, applying, "apply")):
            _, preview = preview_deployment_decision(
                actor=actor, deployment_id=proposal.pk, appointment=appointment.pk, kind=kind
            )
            proposal = decide_deployment(
                actor=actor,
                deployment_id=proposal.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        with use_operator():
            rows = (
                self.tenant.wallet,
                self.tenant.wallet.user_account,
                approver,
                approving.appointee_profile,
                applier,
                applying.appointee_profile,
            )
            admitted_signer()
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
                        self.assertFalse(self.execute(applier.pk)["success"])
                        with use_operator():
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                self.assertNotEqual(cursor.fetchone()[0], observed[0])
                            self.assertEqual(TokenDeployment.objects.get().operation.status, "preparing")
                            self.assertFalse(SignedAttempt.objects.exists())
                            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
                    finally:
                        release.set()
                    future.result(timeout=5)
        self.assertTrue(self.execute(applier.pk)["success"])
        with use_operator():
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(TokenDeployment.objects.get().source_deployment_id, proposal.pk)

    def test_apply_then_revocation_before_first_worker_retains_unsigned_recoverable_journal(self):
        proposal, _ = self.applied()
        revoke_company_appointment(requester=self.actor, appointment_id=self.appointment.pk)
        self.assertFalse(self.execute()["success"])
        with use_operator():
            journal = TokenDeployment.objects.get(pk=proposal.deployment_id)
            operation = journal.operation
            self.assertEqual((journal.source_deployment_id, journal.intent), (proposal.pk, proposal.intent))
            self.assertEqual(operation.status, "preparing")
            self.assertIsNone(operation.current_attempt_id)
            self.assertFalse(SignedAttempt.objects.exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
        self.assertEqual(self.node.broadcasts, [])

    def test_signed_original_recovers_after_company_approval_revocation(self):
        proposal, _ = self.applied()
        self.node.confirmed = False
        self.assertFalse(self.execute()["success"])
        with use_operator():
            attempt = SignedAttempt.objects.get()
        revoke_company_appointment(requester=self.actor, appointment_id=self.appointment.pk)
        with use_operator():
            from blockchain.tests.outgoing_fixtures import receipt

            self.node.receipts[attempt.tx_hash] = receipt(attempt)
            self.node.existing_address = CREATED
            self.assertIsNotNone(deployment.recover(proposal.deployment_id))
            self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])

    def test_existing_operator_base_wallet_needs_no_participant_verification(self):
        with use_operator():
            wallet = Wallet.objects.create(user_account=self.tenant.account, address="0x" + "8" * 40, chain="base")
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(operator_wallet=wallet)
        proposal, _ = self.applied()
        self.assertEqual(proposal.snapshot["issuer_wallet"]["uuid"], str(wallet.pk))
        self.assertEqual(proposal.snapshot["issuer_wallet"]["branch"], "operator")
        self.assertTrue(self.execute()["success"])

    def test_captured_owner_wallet_survives_a_newer_verified_fallback_without_reselection(self):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(operator_wallet=None)
        proposal, _ = self.applied()
        with use_operator():
            newer = Wallet.objects.create(
                user_account=self.tenant.account,
                address="0x" + "7" * 40,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
                verified_at=timezone.now(),
            )
            from companies.services.company import primary_wallet_for

            self.company.refresh_from_db()
            self.assertEqual(primary_wallet_for(self.company).pk, newer.pk)
        self.assertEqual(proposal.snapshot["issuer_wallet"]["uuid"], str(self.tenant.wallet.pk))
        self.assertEqual(proposal.snapshot["issuer_wallet"]["branch"], "owner")
        self.assertTrue(self.execute()["success"])
        with use_operator():
            self.assertEqual(
                TokenDeployment.objects.get().intent["issuer_wallet"].lower(), self.tenant.wallet.address.lower()
            )

    def test_changed_captured_wallet_holds_without_reselecting_a_new_verified_wallet(self):
        proposal, _ = self.applied()
        with use_migrate():
            Wallet.objects.filter(pk=self.tenant.wallet.pk).update(address="0x" + "d" * 40)
        self.assertFalse(self.execute()["success"])
        with use_operator():
            journal = TokenDeployment.objects.get(pk=proposal.deployment_id)
            self.assertEqual(journal.operation.status, "preparing")
            self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_unbound_token_and_proposal_writes_are_refused_with_healthy_command_control(self):
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                type(self.token).objects.filter(pk=self.token.pk).update(status="deploying", deployment_id=uuid4())
            self.assertFalse(RegisterDeployment.objects.exists())
        proposal, _ = self.applied()
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                RegisterDeployment.objects.filter(pk=proposal.pk).update(intent_digest="0" * 64)
            self.assertEqual(RegisterDeploymentDecision.objects.filter(register_deployment=proposal).count(), 2)
            self.assertFalse(OutgoingOperation.objects.exists())

    def test_task_principal_is_the_exact_retained_integer_without_boolean_or_string_coercion(self):
        proposal, _ = self.applied()
        with use_operator():
            for principal in (True, False, str(self.actor.pk), float(self.actor.pk)):
                with self.subTest(principal=principal):
                    response = deploy_share_token_task.func(
                        token_uuid=str(self.token.pk), deployment_id=str(proposal.deployment_id), principal_id=principal
                    )
                    self.assertEqual(response, {"success": False, "error": "Token not found"})
                    self.assertFalse(TokenDeployment.objects.exists())
        self.node.client.assert_expected_chain.assert_not_called()
        self.assertTrue(self.execute()["success"])

    def test_rejection_survives_loss_of_the_captured_wallet_without_requiring_a_new_source(self):
        from wallets.services.registration import delete_wallet

        with use_operator():
            wallet = Wallet.objects.create(
                user_account=self.tenant.wallet.user_account,
                address="0x" + "9" * 40,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
                verified_at=timezone.now(),
            )
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(operator_wallet=None)
        proposal = self.prepare()
        self.assertEqual(proposal.snapshot["issuer_wallet"]["uuid"], str(wallet.pk))
        with acting_for(self.actor.pk):
            delete_wallet(self.actor, wallet.pk)
        _, preview = preview_deployment_decision(
            actor=self.actor,
            deployment_id=proposal.pk,
            appointment=self.appointment.pk,
            kind="reject",
            reason="Captured wallet withdrawn",
        )
        self.assertEqual(preview["unmet_requirements"], [])
        rejected = decide_deployment(
            actor=self.actor,
            deployment_id=proposal.pk,
            appointment=self.appointment.pk,
            kind="reject",
            reason="Captured wallet withdrawn",
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
        self.assertEqual(rejected.status, "rejected")
        with use_operator():
            self.assertFalse(TokenDeployment.objects.exists())
        self.queue.assert_not_called()

    def test_imported_zero_history_is_fenced_before_projection_and_correction_recovers_after_projection(self):
        with use_operator():
            member = RegisterMember.objects.create(company=self.company)
        register_copy = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.SHARE_REGISTER)
        asic = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.ASIC_EXTRACT)
        imported = prepared_import(
            self.actor, import_payload(self.token, register_copy, asic, member, self.appointment)
        )
        decide_import(self.actor, self.appointment, imported, "approve")
        decide_import(self.actor, self.appointment, imported, "apply")
        authority = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.AUTHORITY)
        with use_operator():
            opening = RegisterEntry.objects.get(operation_id=imported.pk)
        zero = prepare_correction(actor=self.actor, **correction_payload(opening, authority, self.appointment))[0]

        def correct(proposal, kind):
            _, preview = preview_correction_decision(
                actor=self.actor, correction_id=proposal.pk, appointment=self.appointment.pk, kind=kind
            )
            return decide_correction(
                actor=self.actor,
                correction_id=proposal.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )

        correct(zero, "approve")
        correct(zero, "apply")
        with use_operator():
            exit_entry = RegisterEntry.objects.get(operation_id=zero.pk)
            head = ShareRegister.objects.get(token=self.token)
            original_head = (head.sequence, head.head_hash, head.issued_supply)
        returning = prepare_correction(actor=self.actor, **correction_payload(exit_entry, authority, self.appointment))[
            0
        ]
        correct(returning, "approve")
        proposal, _ = self.applied()
        with use_operator():
            self.assertFalse(TokenDeployment.objects.exists())
        _, preview = preview_correction_decision(
            actor=self.actor, correction_id=returning.pk, appointment=self.appointment.pk, kind="apply"
        )
        self.assertIn("deployment_pending", preview["unmet_requirements"])
        with patch("tokens.services.register_deployments.pending_deployment", return_value=False), self.assertRaises(
            RegisterChangeConflict
        ):
            correct(returning, "apply")
        with use_operator():
            head.refresh_from_db()
            self.assertEqual((head.sequence, head.head_hash, head.issued_supply), original_head)
            self.assertFalse(RegisterEntry.objects.filter(operation_id=returning.pk).exists())
        self.assertTrue(self.execute()["success"])
        from django.contrib.auth import get_user_model

        with use_migrate():
            staff = get_user_model().objects.create_superuser(
                email=f"issuer-{uuid4()}@example.test", password="synthetic"
            )
        with use_operator():
            request = ShareIssuanceRequest.objects.create(
                token=self.token,
                recipient_address=self.tenant.wallet.address,
                amount=10,
                reason="Synthetic retained legacy review",
            )
            request.approve(staff)
            confirmed = issuance_execution.confirmation(request, staff)
            with self.assertRaises(IssuanceExecutionConflict):
                issuance_execution.admit(request, staff, confirmed=confirmed)
            with patch("tokens.services.issuance_execution._require_register"), self.assertRaises(DatabaseError):
                issuance_execution.admit(request, staff, confirmed=confirmed)
            self.assertFalse(ShareIssuanceExecution.objects.exists())
            self.assertEqual(SignedAttempt.objects.count(), 1)
        correct(returning, "apply")
        with use_operator():
            head.refresh_from_db()
            self.assertEqual((head.sequence, head.issued_supply), (3, 100))
            self.assertEqual(TokenDeployment.objects.get().source_deployment_id, proposal.pk)

    def imported_zero(self):
        with use_operator():
            member = RegisterMember.objects.create(company=self.company)
        register_copy = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.SHARE_REGISTER)
        asic = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.ASIC_EXTRACT)
        imported = prepared_import(
            self.actor, import_payload(self.token, register_copy, asic, member, self.appointment)
        )
        decide_import(self.actor, self.appointment, imported, "approve")
        decide_import(self.actor, self.appointment, imported, "apply")
        authority = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.AUTHORITY)
        with use_operator():
            opening = RegisterEntry.objects.get(operation_id=imported.pk)
        correction = prepare_correction(actor=self.actor, **correction_payload(opening, authority, self.appointment))[0]
        for kind in ("approve", "apply"):
            _, preview = preview_correction_decision(
                actor=self.actor, correction_id=correction.pk, appointment=self.appointment.pk, kind=kind
            )
            decide_correction(
                actor=self.actor,
                correction_id=correction.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        return member, authority

    def test_grant_and_deployment_contend_in_both_orders_and_only_the_first_effect_commits(self):
        from tokens.services.register_deployments import DEPLOYMENTS
        from tokens.services.register_grants import GRANTS

        for winner in ("grant", "deployment"):
            with self.subTest(winner=winner):
                with use_operator():
                    self.token = self.company.tokens.create(
                        name=f"Race {winner}", symbol=winner.upper(), total_supply="1000"
                    )
                member, authority = self.imported_zero()
                terms = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.SUPPORTING)
                grant = prepare_grant(
                    actor=self.actor,
                    operation_id=uuid4(),
                    appointment=self.appointment.pk,
                    token_id=self.token.pk,
                    member=member.pk,
                    new_member=False,
                    name="",
                    residential_address="",
                    shares="25",
                    terms_on=date.today(),
                    approving_director="Synthetic Independent Director",
                    terms="Non-paid grant",
                    authority_reference="SYNTHETIC-RACE",
                    reason="Company-approved grant",
                    authority_evidence=authority.pk,
                    terms_evidence=terms.pk,
                    acceptance_required=False,
                    acceptance_evidence=None,
                )[0]
                grant_values = dict(
                    actor=self.actor,
                    grant_id=grant.pk,
                    appointment=self.appointment.pk,
                    kind="approve",
                    idempotency_key=uuid4(),
                    confirmation=True,
                )
                grant_values["preview_digest"] = preview_grant_decision(
                    actor=self.actor, grant_id=grant.pk, appointment=self.appointment.pk, kind="approve"
                )[1]["preview_digest"]
                decide_grant(**grant_values)
                grant_values.update(
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=preview_grant_decision(
                        actor=self.actor, grant_id=grant.pk, appointment=self.appointment.pk, kind="apply"
                    )[1]["preview_digest"],
                )
                proposed = self.prepare()
                self.decide(proposed, "approve")
                deployment_values = dict(
                    actor=self.actor,
                    deployment_id=proposed.pk,
                    appointment=self.appointment.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    confirmation=True,
                    preview_digest=preview_deployment_decision(
                        actor=self.actor, deployment_id=proposed.pk, appointment=self.appointment.pk, kind="apply"
                    )[1]["preview_digest"],
                )
                entered, release, loser_started = Event(), Event(), Event()
                pids = {}
                family = GRANTS if winner == "grant" else DEPLOYMENTS
                module = (
                    "tokens.services.register_grants.GRANTS"
                    if winner == "grant"
                    else "tokens.services.register_deployments.DEPLOYMENTS"
                )

                def apply_first(*args):
                    family.apply(*args)
                    entered.set()
                    self.assertTrue(release.wait(10))

                def run(name):
                    connections.close_all()
                    try:
                        with use_operator():
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SET lock_timeout='15s'")
                                cursor.execute("SELECT pg_backend_pid()")
                                pids[name] = cursor.fetchone()[0]
                            if name != winner:
                                loser_started.set()
                            if name == "grant":
                                return decide_grant(**grant_values)
                            return decide_deployment(**deployment_values)
                    finally:
                        connections.close_all()

                loser = "deployment" if winner == "grant" else "grant"
                inspection = connections["default"].copy()
                try:
                    with patch(module, replace(family, apply=apply_first)), ThreadPoolExecutor(max_workers=2) as pool:
                        first = pool.submit(run, winner)
                        self.assertTrue(entered.wait(5))
                        second = pool.submit(run, loser)
                        try:
                            self.assertTrue(loser_started.wait(5))
                            self.wait_for_pid(inspection, pids[loser], pids[winner], row=self.company)
                        finally:
                            release.set()
                        self.assertEqual(first.result(timeout=10).status, "applied")
                        with self.assertRaises(RegisterChangeConflict):
                            second.result(timeout=10)
                finally:
                    inspection.close()
                with use_operator():
                    register = ShareRegister.objects.get(token=self.token)
                    proposed.refresh_from_db()
                    self.token.refresh_from_db()
                    self.assertEqual(register.issued_supply, 25 if winner == "grant" else 0)
                    self.assertEqual(register.sequence, 3 if winner == "grant" else 2)
                    self.assertEqual(proposed.status, "applied" if winner == "deployment" else "submitted")
                    self.assertEqual(self.token.status, "deploying" if winner == "deployment" else "draft")
                    self.assertFalse(TokenDeployment.objects.exists())

    def test_waited_register_head_reads_a_newly_committed_deployment_source_before_a_positive_correction(self):
        from tokens.services.register_deployments import DEPLOYMENTS

        with use_operator():
            member = RegisterMember.objects.create(company=self.company)
            opening = open_register(
                token_id=self.token.pk,
                operation_id=uuid4(),
                changes=[{"member": str(member.pk), "shares": "100"}],
                effective_on=date.today(),
                recorded_by=self.actor,
            )
        authority = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.AUTHORITY)
        zero = prepare_correction(actor=self.actor, **correction_payload(opening, authority, self.appointment))[0]
        for kind in ("approve", "apply"):
            _, preview = preview_correction_decision(
                actor=self.actor, correction_id=zero.pk, appointment=self.appointment.pk, kind=kind
            )
            decide_correction(
                actor=self.actor,
                correction_id=zero.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        with use_operator():
            entry = RegisterEntry.objects.get(operation_id=zero.pk)
            register = ShareRegister.objects.get(token=self.token)
            before = (register.sequence, register.head_hash, register.issued_supply)
        proposal = self.prepare()
        self.decide(proposal, "approve")
        _, preview = preview_deployment_decision(
            actor=self.actor, deployment_id=proposal.pk, appointment=self.appointment.pk, kind="apply"
        )
        entered, release, started = Event(), Event(), Event()
        pids = {}

        def apply_first(*args):
            DEPLOYMENTS.apply(*args)
            entered.set()
            self.assertTrue(release.wait(10))

        def run(name):
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout='15s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        pids[name] = cursor.fetchone()[0]
                    if name == "deployment":
                        return decide_deployment(
                            actor=self.actor,
                            deployment_id=proposal.pk,
                            appointment=self.appointment.pk,
                            kind="apply",
                            idempotency_key=uuid4(),
                            preview_digest=preview["preview_digest"],
                            confirmation=True,
                        )
                    started.set()
                    with atomic():
                        return RegisterEntry.objects.create(
                            register=register,
                            operation_id=uuid4(),
                            kind="correction",
                            changes=opening.changes,
                            effective_on=date.today(),
                            recorded_by=self.actor,
                            corrects=entry,
                        )
            finally:
                connections.close_all()

        inspection = connections["default"].copy()
        try:
            with patch(
                "tokens.services.register_deployments.DEPLOYMENTS", replace(DEPLOYMENTS, apply=apply_first)
            ), ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(run, "deployment")
                self.assertTrue(entered.wait(5))
                second = pool.submit(run, "entry")
                try:
                    self.assertTrue(started.wait(5))
                    self.wait_for_pid(inspection, pids["entry"], pids["deployment"], query="INSERT INTO")
                finally:
                    release.set()
                self.assertEqual(first.result(timeout=10).status, "applied")
                with self.assertRaises(DatabaseError) as refusal:
                    second.result(timeout=10)
                self.assertEqual(refusal.exception.__cause__.sqlstate, "23514")
                self.assertIn("until original projection", str(refusal.exception))
        finally:
            inspection.close()
        with use_operator():
            register.refresh_from_db()
            self.assertEqual((register.sequence, register.head_hash, register.issued_supply), before)
        self.assertTrue(self.execute()["success"])
        correction = prepare_correction(actor=self.actor, **correction_payload(entry, authority, self.appointment))[0]
        for kind in ("approve", "apply"):
            _, current = preview_correction_decision(
                actor=self.actor, correction_id=correction.pk, appointment=self.appointment.pk, kind=kind
            )
            decide_correction(
                actor=self.actor,
                correction_id=correction.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=current["preview_digest"],
                confirmation=True,
            )
        with use_operator():
            register.refresh_from_db()
            self.assertEqual((register.sequence, register.issued_supply), (3, 100))

    def test_projection_requires_a_genuine_chain_opening_instead_of_a_direct_forged_opening(self):
        proposal, _ = self.applied()
        self.assertTrue(self.execute()["success"])
        with use_operator(), self.assertRaises(RegisterChangeConflict):
            open_register(
                token_id=self.token.pk,
                operation_id=uuid4(),
                changes=[],
                effective_on=date.today(),
                recorded_by=self.actor,
            )
        with use_operator():
            self.assertFalse(ShareRegister.objects.filter(token=self.token).exists())
            self.assertEqual(TokenDeployment.objects.get().source_deployment_id, proposal.pk)

    def test_default_deferred_apply_authority_expiry_rolls_back_admission_and_queue(self):
        applier, applying = self.appoint(["apply"], expires_at=timezone.now() + timedelta(seconds=3))
        proposal = self.prepare()
        self.decide(proposal, "approve")
        _, preview = preview_deployment_decision(
            actor=applier, deployment_id=proposal.pk, appointment=applying.pk, kind="apply"
        )
        from tokens.services.register_deployments import DEPLOYMENTS

        def delay(*args):
            DEPLOYMENTS.apply(*args)
            observer = connections[current_alias()].copy(alias="deployment_queue_observer")
            try:
                with observer.cursor() as cursor:
                    cursor.execute(
                        "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'token_uuid'=%s",
                        [deploy_share_token_task.name, str(self.token.pk)],
                    )
                    self.assertEqual(cursor.fetchone()[0], 0)
            finally:
                observer.close()
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz - clock_timestamp()))) + 0.05)",
                    [applying.expires_at],
                )

        from dataclasses import replace

        with patch("tokens.services.register_deployments.DEPLOYMENTS", replace(DEPLOYMENTS, apply=delay)), patch(
            "tokens.services.register_deployments.queue_deployment", self.real_defer
        ), self.assertRaises(RegisterChangeConflict):
            decide_deployment(
                actor=applier,
                deployment_id=proposal.pk,
                appointment=applying.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        with use_operator():
            self.token.refresh_from_db()
            proposal.refresh_from_db()
            self.assertEqual(self.token.status, "draft")
            self.assertIsNone(self.token.deployment_id)
            self.assertEqual(proposal.status, "submitted")
            self.assertEqual(RegisterDeploymentDecision.objects.filter(register_deployment=proposal).count(), 1)
            self.assertFalse(TokenDeployment.objects.exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'token_uuid'=%s",
                    [deploy_share_token_task.name, str(self.token.pk)],
                )
                self.assertEqual(cursor.fetchone()[0], 0)
        healthy, _ = self.decide(proposal, "apply")
        self.assertEqual(healthy.status, "applied")

    def test_default_deferred_preparation_expiry_rolls_back_the_private_source(self):
        preparer, preparing = self.appoint(["prepare"], expires_at=timezone.now() + timedelta(seconds=3))
        original_save = RegisterDeployment.save

        def delay(proposal, *args, **kwargs):
            original_save(proposal, *args, **kwargs)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz - clock_timestamp()))) + 0.05)",
                    [preparing.expires_at],
                )

        with patch.object(RegisterDeployment, "save", delay), self.assertRaises(RegisterChangeConflict):
            prepare_deployment(actor=preparer, operation_id=uuid4(), appointment=preparing.pk, token=self.token.pk)
        with use_operator():
            self.assertFalse(RegisterDeployment.objects.exists())
            self.assertFalse(RegisterDeploymentDecision.objects.exists())
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "draft")
            self.assertIsNone(self.token.deployment_id)
        self.assertEqual(self.prepare().status, "submitted")

    def test_default_deferred_signature_expiry_rolls_back_bytes_nonce_and_public_association(self):
        applier, applying = self.appoint(["apply"], expires_at=timezone.now() + timedelta(seconds=3))
        proposal = self.prepare()
        self.decide(proposal, "approve")
        _, preview = preview_deployment_decision(
            actor=applier, deployment_id=proposal.pk, appointment=applying.pk, kind="apply"
        )
        proposal = decide_deployment(
            actor=applier,
            deployment_id=proposal.pk,
            appointment=applying.pk,
            kind="apply",
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
        from tokens.services.deployment_journal import record_signed_deployment

        def delay(*args):
            record_signed_deployment(*args)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (%s::timestamptz - clock_timestamp()))) + 0.05)",
                    [applying.expires_at],
                )

        with use_operator(), patch("tokens.services.deployment_journal.record_signed_deployment", side_effect=delay):
            admitted_signer()
            self.token.refresh_from_db()
            outcome = deploy_share_token_task.func(
                token_uuid=str(self.token.pk), deployment_id=str(proposal.deployment_id), principal_id=applier.pk
            )
            self.assertFalse(outcome["success"])
            self.token.refresh_from_db()
            journal = TokenDeployment.objects.get(pk=proposal.deployment_id)
            self.assertEqual(journal.operation.status, "preparing")
            self.assertIsNone(journal.transaction_id)
            self.assertIsNone(self.token.deployment_transaction_id)
            self.assertIsNone(self.token.deployment_tx_hash)
            self.assertFalse(SignedAttempt.objects.exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
        self.assertEqual(self.node.broadcasts, [])

    def test_preapproved_first_import_cannot_open_an_admitted_or_projected_empty_deployment(self):
        with use_operator():
            member = RegisterMember.objects.create(company=self.company)
        register_copy = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.SHARE_REGISTER)
        asic = upload_evidence(self.actor, self.appointment, RegisterEvidenceKind.ASIC_EXTRACT)
        imported = prepared_import(
            self.actor, import_payload(self.token, register_copy, asic, member, self.appointment)
        )
        decide_import(self.actor, self.appointment, imported, "approve")
        proposal, _ = self.applied()
        for projected in (False, True):
            with self.subTest(projected=projected):
                if projected:
                    self.assertTrue(self.execute()["success"])
                with self.assertRaises(ValidationError):
                    decide_import(self.actor, self.appointment, imported, "apply")
                with patch("tokens.services.register_imports._check_openable"), patch(
                    "tokens.services.register_imports._effect_requirements", return_value=[]
                ), patch(
                    "tokens.services.register_deployments.pending_deployment", return_value=False
                ), self.assertRaises(
                    RegisterChangeConflict
                ):
                    decide_import(self.actor, self.appointment, imported, "apply")
                with use_operator():
                    self.assertFalse(ShareRegister.objects.filter(token=self.token).exists())
                    self.assertFalse(RegisterEntry.objects.filter(operation_id=imported.pk).exists())
                    self.assertEqual(RegisterDeployment.objects.get(pk=proposal.pk).status, "applied")


class ScopedRegisterDeploymentsTest(RunsOnTheScopedConnection, RegisterDeploymentsTest):
    pass
