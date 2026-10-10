from contextlib import nullcontext
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.services.outgoing import OutgoingTransactionError
from shared.db import atomic, use_migrate, use_operator
from shared.tests.retained_rows import retained_rows
from shared.tests.tenants import make_tenant
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.exceptions import IssuanceExecutionConflict
from tokens.models import (
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterMember,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
)
from tokens.services import issuance_execution
from tokens.services.register_inclusions import opened_by_import, opening_boundary
from tokens.tests.evidence_fixtures import owner_appointment, upload_evidence
from tokens.tests.issuance_fixtures import (
    CHAIN_ID,
    FINALITY_POLICIES,
    KEY,
    IssuanceNode,
    admit,
    install_issuance,
)
from tokens.tests.retained_guards import ISSUANCE_GUARDS, REQUEST_GUARDS
from tokens.tests.test_register_corrections import (
    apply_correction,
    correction_payload,
)
from tokens.tests.test_register_corrections import prepared as prepare_correction
from tokens.tests.test_register_imports import apply_import, import_payload
from tokens.tests.test_register_imports import prepared as prepare_import


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES,
)
class RegisterDeploymentIssuanceGuardTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.node = IssuanceNode()
        self.enterContext(
            patch("tokens.services.issuance_execution.get_base_chain_client", return_value=self.node.client)
        )
        self.enterContext(patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=True))
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))

    def imported_zero(self):
        from blockchain.tests.outgoing_fixtures import admitted_signer

        with use_operator():
            self.tenant = make_tenant("retained-imported-issuance")
            self.token = self.tenant.deployed_token
            self.owner = self.tenant.user
            appointment = owner_appointment(self.token.company)
            member = RegisterMember.objects.create(company=self.token.company)
        register_copy = upload_evidence(self.owner, appointment, RegisterEvidenceKind.SHARE_REGISTER)
        asic = upload_evidence(self.owner, appointment, RegisterEvidenceKind.ASIC_EXTRACT)
        proposal = prepare_import(self.owner, import_payload(self.token, register_copy, asic, member, appointment))
        apply_import(self.owner, appointment, proposal)
        authority = upload_evidence(self.owner, appointment, RegisterEvidenceKind.AUTHORITY)
        with use_operator():
            opening = RegisterEntry.objects.get(operation_id=proposal.pk)
        correction = prepare_correction(self.owner, correction_payload(opening, authority, appointment))
        apply_correction(self.owner, appointment, correction)
        with use_migrate():
            self.actor = get_user_model().objects.create_superuser(
                email="retained-issuance-operator@example.test", password="synthetic"
            )
        with use_migrate(), retained_rows(*REQUEST_GUARDS), use_operator():
            self.request = ShareIssuanceRequest.objects.create(
                token=self.token,
                recipient_address=self.tenant.wallet.address,
                amount=10,
                reason="Retained staff-approved synthetic issue",
            )
            self.request.approve(self.actor)
            admitted_signer()
        with use_operator():
            self.head = ShareRegister.objects.filter(token=self.token).values().get()
            self.assertEqual((self.head["sequence"], self.head["issued_supply"]), (2, 0))
            self.assertTrue(opened_by_import(self.token.pk))
            self.assertIsNone(opening_boundary(self.token.pk))

    def historical_admission(self):
        with use_migrate(), retained_rows(
            *ISSUANCE_GUARDS, ("tokens_shareissuanceexecution", "protect_issuance_execution")
        ):
            executions = ShareIssuanceExecution.objects
            with use_operator():
                command = executions.create(
                    pk=self.request.dispatch_id,
                    request_id=self.request.pk,
                    token_id=self.token.pk,
                    company_id=self.token.company_id,
                    executed_by_id=self.actor.pk,
                    authority=issuance_execution.REQUEST_AUTHORITY,
                    intent=issuance_execution._intent(self.request, self.token),
                )
            return command

    def historical_start(self):
        with use_migrate(), retained_rows(
            *ISSUANCE_GUARDS, ("tokens_shareissuanceexecution", "protect_issuance_execution")
        ):
            command = self.historical_admission()
            issuances = ShareIssuance.objects
            executions = ShareIssuanceExecution.objects
            requests = ShareIssuanceRequest.objects
            with use_operator(), atomic(durable=True):
                issuance = issuances.create(
                    token_id=self.token.pk,
                    recipient_address=command.intent["recipient"],
                    recipient_name=self.tenant.profile.full_name,
                    amount=command.intent["amount"],
                    issuance_type=self.request.issuance_type,
                    reason=f"Issuance request: {self.request.reason}",
                    initiated_by_id=self.actor.pk,
                    idempotency_key=f"issuance-request:{self.request.pk}",
                )
                executions.filter(pk=command.pk).update(status="executing", issuance_id=issuance.pk)
                requests.filter(pk=self.request.pk).update(status="executing", updated_at=timezone.now())
            with use_operator():
                intent = {field: command.intent[field] for field in issuance_execution.INTENT_FIELDS}
                intent["value"] = int(intent["value"])
                claim = outgoing.open_operation(f"share-issuance:{self.request.pk}:{command.pk}", **intent)
                command = executions.get(pk=command.pk)
                command.operation_id = claim.operation_id
                command.save(update_fields=["operation", "updated_at"])
            return command, claim

    def retain_signed(self, command, attempt):
        with use_operator():
            record = BlockchainTransaction.objects.create(
                tx_hash=attempt.tx_hash,
                tx_type="token_mint",
                status="submitted",
                from_address=command.intent["sender"],
                to_address=command.intent["to"],
                function_name="mint",
                function_args={"recipient": command.intent["recipient"], "amount": command.intent["amount"]},
                related_model="tokens.ShareIssuanceRequest",
                related_uuid=self.request.pk,
                submitted_at=attempt.created_at,
            )
            command.transaction_id = record.pk
            command.save(update_fields=["transaction", "updated_at"])
            issuances = ShareIssuance.objects
            issuances.filter(pk=command.issuance_id).update(
                transaction_id=record.pk,
                tx_hash=attempt.tx_hash,
                status="processing",
                processed_at=attempt.created_at,
                updated_at=attempt.created_at,
            )

    def unchanged_unsigned(self):
        with use_operator():
            self.assertFalse(SignedAttempt.objects.exists())
            self.assertEqual(SigningAccount.objects.get().next_nonce, 0)
            self.assertEqual(ShareRegister.objects.filter(token=self.token).values().get(), self.head)
        self.assertEqual(self.node.broadcasts, [])

    def test_non_imported_class_keeps_its_existing_admission_and_finalized_execution(self):
        install_issuance(self)
        with use_operator():
            self.assertFalse(opened_by_import(self.token.pk))
            command = admit(self.request, self.actor)
            result = issuance_execution.recover(command.pk)
            self.assertEqual(result["status"], "executed")
            self.assertEqual(self.attempts.count(), 1)
            self.assertEqual(len(self.node.broadcasts), 1)
            command.refresh_from_db()
            self.assertEqual(command.finalized_receipt["block_number"], self.node.receipt_height)

    def test_new_service_and_sql_admission_refuse_the_genuine_imported_zero_book(self):
        self.imported_zero()
        with use_operator():
            with self.assertRaisesMessage(IssuanceExecutionConflict, "An imported register"):
                issuance_execution.admit(
                    self.request, self.actor, confirmed=issuance_execution.confirmation(self.request, self.actor)
                )
            with self.assertRaisesMessage(DatabaseError, "Imported registers"), atomic():
                ShareIssuanceExecution.objects.create(
                    pk=self.request.dispatch_id,
                    request_id=self.request.pk,
                    token_id=self.token.pk,
                    company_id=self.token.company_id,
                    executed_by_id=self.actor.pk,
                    authority=issuance_execution.REQUEST_AUTHORITY,
                    intent=issuance_execution._intent(self.request, self.token),
                )
            self.assertFalse(ShareIssuanceExecution.objects.exists())
            self.assertFalse(OutgoingOperation.objects.exists())
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "approved")
        self.unchanged_unsigned()

    def test_retained_queued_admission_is_held_without_fresh_execution(self):
        self.imported_zero()
        command = self.historical_admission()
        with use_operator():
            original = ShareIssuanceExecution.objects.values().get(pk=command.pk)
        with use_operator():
            current = ShareIssuanceExecution.objects.values().get(pk=command.pk)
            self.assertIsNone(current["source_instruction_id"])
            self.assertEqual(current, original)
            with self.assertRaisesMessage(IssuanceExecutionConflict, "An imported register"):
                issuance_execution.recover(command.pk)
            self.assertEqual(ShareIssuanceExecution.objects.get(pk=command.pk).status, "queued")
            self.assertFalse(OutgoingOperation.objects.exists())
        self.unchanged_unsigned()

    def test_retained_unsigned_operation_cannot_sign_through_service_or_sql(self):
        self.imported_zero()
        command, claim = self.historical_start()
        with use_operator():
            prepared = outgoing.prepare_operation(claim, self.node.client)
            with patch("eth_account.signers.local.LocalAccount.sign_transaction") as signature:
                with self.assertRaises(OutgoingTransactionError):
                    outgoing.sign_operation(
                        claim,
                        prepared,
                        KEY,
                        signing_context=lambda: issuance_execution._signing_register(command),
                        on_signed=lambda attempt: issuance_execution._record_signed(command.pk, attempt),
                    )
                signature.assert_not_called()
            self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).status, "preparing")
            with self.assertRaisesMessage(
                DatabaseError, "Fresh issuance signatures require the current original company source"
            ):
                outgoing.sign_operation(
                    claim,
                    prepared,
                    KEY,
                    signing_context=nullcontext,
                    on_signed=lambda attempt: issuance_execution._record_signed(command.pk, attempt),
                )
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "failed")
        self.unchanged_unsigned()

    def test_retained_failed_claim_cannot_enter_a_fresh_retry(self):
        self.imported_zero()
        command, claim = self.historical_start()
        with use_operator():
            outgoing.fail_preparing(claim)
            issuance_execution._project(command, claim)
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, "failed")
        with use_operator():
            with self.assertRaisesMessage(IssuanceExecutionConflict, "An imported register"):
                issuance_execution.admit(
                    self.request, self.actor, confirmed=issuance_execution.confirmation(self.request, self.actor)
                )
            with self.assertRaisesMessage(DatabaseError, "Imported registers"), atomic():
                ShareIssuanceExecution.objects.filter(pk=command.pk).update(status="queued", retry_of=claim.claim_id)
            self.assertEqual(ShareIssuanceExecution.objects.get(pk=command.pk).status, "failed")
            self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).claim_id, claim.claim_id)
        self.unchanged_unsigned()

    def test_retained_signed_original_recovers_its_exact_bytes_and_finality(self):
        self.imported_zero()
        command, claim = self.historical_start()
        with use_migrate(), retained_rows(
            *ISSUANCE_GUARDS,
            ("tokens_shareissuanceexecution", "protect_issuance_execution"),
            ("blockchain_signedattempt", "tokens_deployment_signature_current"),
            ("blockchain_signedattempt", "tokens_deployment_signature_source"),
        ), use_operator():
            attempt = outgoing.sign_operation(
                claim,
                outgoing.prepare_operation(claim, self.node.client),
                KEY,
                on_signed=lambda signed: self.retain_signed(command, signed),
                signing_context=nullcontext,
            )
        with use_operator():
            self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).status, "signed")
            original = SignedAttempt.objects.values().get(pk=attempt.pk)
            command.refresh_from_db()
            self.assertIsNotNone(command.transaction_id)
            result = issuance_execution.recover(command.pk)
            self.assertEqual((result["status"], result["tx_hash"]), ("executed", attempt.tx_hash))
            self.assertEqual(SignedAttempt.objects.values().get(pk=attempt.pk), original)
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)
            self.assertEqual(ShareRegister.objects.filter(token=self.token).values().get(), self.head)
            command.refresh_from_db()
            self.assertEqual(command.finalized_receipt["block_number"], 12)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])
