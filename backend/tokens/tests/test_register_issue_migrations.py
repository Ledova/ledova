from django.db import connections
from rest_framework.test import APITransactionTestCase

from shared.db import current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import (
    RegisterInstruction,
    RegisterInstructionDecision,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.tests.company_issue_fixtures import CompanyIssueCases
from tokens.tests.instruction_fixtures import (
    instruction_reviewer,
    verified_authority,
)

NEW_INSTRUCTION_COLUMNS = (
    "paid_subscription_id",
    "preparing_appointment_id",
    "member_id",
    "nomination_id",
    "wallet_approval_id",
    "request_id",
    "terms_on",
    "terms",
    "acceptance_required",
    "authority_evidence_id",
    "terms_evidence_id",
    "terms_fingerprint",
    "terms_snapshot",
    "terms_file",
    "acceptance_evidence_id",
    "acceptance_fingerprint",
    "acceptance_snapshot",
    "acceptance_file",
    "snapshot",
    "intent",
    "intent_digest",
    "approval_decision_id",
)


class RegisterIssueMigrationTest(CompanyIssueCases, APITransactionTestCase):
    def installed_instruction_guard(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure(%s)", ["tokens_guard_register_instruction()"]
            )
            return cursor.fetchone()[0]

    def test_empty_reverse_and_forward_preserve_exact_legacy_instruction_terms_evidence_and_null_sources(self):
        with use_operator():
            actor = instruction_reviewer()
            document = verified_authority(self.company, actor)
            from django.core.files.base import ContentFile

            from companies.services.document_review import verified_document_snapshot
            from tokens.services.register_evidence import private_document_bytes

            raw = private_document_bytes(document.file)
            evidence_snapshot = verified_document_snapshot(document, content=ContentFile(raw))
        try:
            historical = migrate_to([("tokens", "0099_company_register_deployment_guards")])
            original_instruction_guard = self.installed_instruction_guard()
            with use_operator():
                request = (
                    historical.get_model("tokens", "ShareIssuanceRequest")
                    .objects.using(current_alias())
                    .create(
                        token_id=self.token.pk,
                        company_id=self.company.pk,
                        recipient_address=self.wallet.address,
                        recipient_name="Retained legacy recipient",
                        amount=10,
                        reason="Retained prior approved issue",
                        status="approved",
                        reviewed_by_id=actor.pk,
                    )
                )
                model = historical.get_model("tokens", "RegisterInstruction")
                from uuid import uuid4

                proposal = model(
                    uuid=uuid4(),
                    company_id=self.company.pk,
                    token_id=self.token.pk,
                    kind="issue",
                    items=[{"request": str(request.pk), "recipient": self.wallet.address, "amount": "10"}],
                    approving_director="Synthetic Director",
                    authority_reference="RETAINED-ISSUE",
                    reason="Retained instruction",
                    source_document=document.pk,
                    evidence_fingerprint=document.verified_fingerprint,
                    evidence_snapshot=evidence_snapshot,
                    submitted_by_id=self.owner.pk,
                )
                proposal.file.save("authority.bin", ContentFile(raw), save=False)
                proposal.save(using=current_alias(), force_insert=True)
                values = model.objects.using(current_alias()).filter(pk=proposal.pk).values().get()
                with proposal.file.open("rb") as handle:
                    retained = handle.read()
            historical = migrate_to([("tokens", "0099_company_register_deployment_guards")])
            with use_operator():
                original = (
                    historical.get_model("tokens", "RegisterInstruction")
                    .objects.using(current_alias())
                    .filter(pk=proposal.pk)
                    .values()
                    .get()
                )
                self.assertEqual(original, values)
        finally:
            restore_every_migration()
        try:
            migrate_to([("tokens", "0100_company_register_issue_instructions")])
            self.assertEqual(self.installed_instruction_guard(), original_instruction_guard)
        finally:
            restore_every_migration()
        with use_operator():
            current = RegisterInstruction.objects.get(pk=proposal.pk)
            restored = RegisterInstruction.objects.filter(pk=proposal.pk).values().get()
            for field in NEW_INSTRUCTION_COLUMNS:
                self.assertIsNone(restored.pop(field))
            self.assertEqual(restored, values)
            with current.file.open("rb") as handle:
                self.assertEqual(handle.read(), retained)
            self.assertFalse(RegisterInstructionDecision.objects.exists())
            self.assertFalse(ShareIssuanceExecution.objects.exists())
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=request.pk).status, "approved")
        self.assertEqual(self.applied_issue().status, "applied")

    def test_prepared_and_applied_company_history_refuses_reversal_without_losing_original_data(self):
        proposal = self.prepare_issue()
        with use_operator():
            before = RegisterInstruction.objects.filter(pk=proposal.pk).values().get()
        try:
            with self.assertRaisesMessage(RuntimeError, "Retain company issue sources"):
                migrate_to([("tokens", "0099_company_register_deployment_guards")])
        finally:
            restore_every_migration()
        with use_operator():
            self.assertEqual(RegisterInstruction.objects.filter(pk=proposal.pk).values().get(), before)
        self.issue_decide(proposal, "approve")
        self.issue_decide(proposal, "apply")
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            before = RegisterInstruction.objects.filter(pk=proposal.pk).values().get()
            intent = execution.intent
        try:
            with self.assertRaisesMessage(RuntimeError, "Retain company issue sources"):
                migrate_to([("tokens", "0099_company_register_deployment_guards")])
        finally:
            restore_every_migration()
        with use_operator():
            self.assertEqual(RegisterInstruction.objects.filter(pk=proposal.pk).values().get(), before)
            self.assertEqual(ShareIssuanceExecution.objects.get(pk=execution.pk).intent, intent)
            self.assertEqual(RegisterInstructionDecision.objects.filter(instruction=proposal).count(), 2)
        self.assertEqual(self.execute_issue(proposal)["status"], "executed")
