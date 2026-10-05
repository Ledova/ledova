from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connection, connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from companies.exceptions import IssuerIdentityVerificationRequiredException
from companies.models import CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from operators.models import Operator
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.storage import private_storage
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterCorrection,
    RegisterCorrectionDecision,
    RegisterEvidence,
    RegisterEvidenceKind,
)
from tokens.services.register_corrections import decide_correction, prepare_correction
from tokens.services.register_events import record_entry
from tokens.services.register_evidence import evidence_snapshot
from tokens.tests.test_register_access import person
from tokens.tests.test_register_corrections import (
    correction_fixture,
    correction_payload,
    decide,
    decision_digest,
    forge_decision,
    forge_outcome,
    forged_fields,
    insert_forged,
    prepared,
    preview,
    staff_era,
)
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import (
    DOCUMENT_BYTES,
    staff_user,
    upload_evidence,
)
from users.models import UserProfile

EVIDENCE = "/api/v1/tokens/register-evidence/"
CORRECTIONS = "/api/v1/tokens/register-corrections/"


class CorrectionAuthorityFixture(AppointsTeam):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.administrator, self.issue, self.evidence = correction_fixture()

    def prepare_as(self, actor, appointment, **changes):
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        return prepared(actor, correction_payload(self.issue, evidence, appointment, **changes))

    def prepared_by_the_owner(self, **changes):
        return prepared(self.owner, correction_payload(self.issue, self.evidence, self.administrator, **changes))


class RegisterCorrectionAuthorityTest(CorrectionAuthorityFixture, StubUploadDependencies, APITransactionTestCase):
    def test_each_step_takes_its_own_capability_or_administration_and_one_person_may_take_every_step(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        proposal = self.prepare_as(preparer, preparing)
        self.assertEqual((proposal.submitted_by_id, proposal.preparing_appointment_id), (preparer.pk, preparing.pk))
        for actor, appointment, kind in (
            (preparer, preparing, "approve"),
            (applier, applying, "approve"),
            (approver, approving, "apply"),
            (preparer, preparing, "reject"),
            (applier, applying, "reject"),
        ):
            with self.subTest(actor=actor.email, kind=kind):
                reason = "No" if kind == "reject" else ""
                self.assertIn(
                    "appointment_capability_required",
                    preview(actor, appointment, proposal, kind, reason)["unmet_requirements"],
                )
                with self.assertRaisesMessage(ValidationError, "appointment_capability_required"):
                    decide(actor, appointment, proposal, kind, reason)
        decide(approver, approving, proposal, "approve")
        applied = decide(applier, applying, proposal, "apply")
        with use_operator():
            decisions = [
                (row.kind, row.decided_by_id, row.appointment_id) for row in applied.decisions.order_by("decided_at")
            ]
        self.assertEqual(decisions, [("approve", approver.pk, approving.pk), ("apply", applier.pk, applying.pk)])
        self.assertEqual(
            (applied.status, applied.reviewed_by_id, applied.applied_entry.recorded_by_id),
            ("applied", applier.pk, applier.pk),
        )

    def test_an_administrator_alone_prepares_approves_and_applies(self):
        proposal = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, proposal, "approve")
        self.assertEqual(decide(self.owner, self.administrator, proposal, "apply").status, "applied")

    def test_appointments_without_preparation_and_platform_roles_prepare_nothing(self):
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        finance, financing = self.appoint([CompanyCapability.FINANCE])
        staff = staff_user()
        for actor, appointment in ((reader, reading), (finance, financing), (staff, self.administrator)):
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                prepared(actor, correction_payload(self.issue, self.evidence, appointment))
        with use_operator():
            self.assertFalse(RegisterCorrection.objects.exists())

    def test_only_the_preparers_own_authority_upload_for_this_company_can_be_used(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            prepared(preparer, correction_payload(self.issue, self.evidence, preparing))
        register_copy = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SHARE_REGISTER)
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            self.prepared_by_the_owner(authority_evidence=register_copy.pk)
        with use_operator():
            stranger, _, foreign_administrator, foreign_issue, foreign_evidence = correction_fixture()
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            self.prepared_by_the_owner(authority_evidence=foreign_evidence.pk)
        for actor, payload in (
            (stranger, correction_payload(self.issue, foreign_evidence, foreign_administrator)),
            (self.owner, correction_payload(foreign_issue, self.evidence, self.administrator)),
        ):
            with self.subTest(actor=actor.email), self.assertRaisesMessage(NotFound, "Register entry not found"):
                prepared(actor, payload)
        proposal = self.prepared_by_the_owner()
        with self.assertRaisesMessage(NotFound, "Register correction not found"):
            preview(stranger, foreign_administrator, proposal, "approve")
        with use_operator():
            self.assertEqual(list(RegisterCorrection.objects.values_list("pk", flat=True)), [proposal.pk])

    def test_revocation_after_a_preview_refuses_the_decision_and_records_nothing(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = self.prepared_by_the_owner()
        digest = preview(approver, approving, proposal, "approve")["preview_digest"]
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        with self.assertRaises(NotFound):
            decide_correction(
                actor=approver,
                correction_id=proposal.pk,
                appointment=approving.pk,
                kind="approve",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with use_operator():
            self.assertFalse(RegisterCorrectionDecision.objects.exists())

    def reappoint(self, appointee, capabilities):
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.administrator.pk,
            idempotency_key=uuid4(),
            capabilities=list(capabilities),
            delegatable_capabilities=[],
        )
        return accept_team_invitation(
            requester=appointee, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )

    def test_a_preview_binds_its_correction_appointment_and_reason(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        with use_operator():
            other_issue = record_entry(
                register_id=self.issue.register_id,
                operation_id=uuid4(),
                kind="issue",
                changes=self.issue.changes,
                effective_on=self.issue.effective_on,
                recorded_by=self.owner,
            )
        proposal = self.prepared_by_the_owner()
        other = prepared(
            self.owner,
            correction_payload(
                other_issue,
                upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY),
                self.administrator,
            ),
        )

        def decided(correction, appointment, kind, digest, reason=""):
            return decide_correction(
                actor=approver,
                correction_id=correction.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
                reason=reason,
            )

        approval = preview(approver, approving, proposal, "approve")["preview_digest"]
        rejection = preview(approver, approving, proposal, "reject", "The resolution was withdrawn")["preview_digest"]
        with self.subTest(bound="correction"), self.assertRaises(RegisterChangeConflict):
            decided(other, approving, "approve", approval)
        with self.subTest(bound="reason"), self.assertRaises(RegisterChangeConflict):
            decided(proposal, approving, "reject", rejection, "Another reason")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        reappointed = self.reappoint(approver, [CompanyCapability.APPROVE])
        with self.subTest(bound="appointment"), self.assertRaises(RegisterChangeConflict):
            decided(proposal, reappointed, "approve", approval)
        with use_operator():
            self.assertFalse(RegisterCorrectionDecision.objects.exists())
        self.assertEqual(
            decided(
                proposal, reappointed, "approve", preview(approver, reappointed, proposal, "approve")["preview_digest"]
            ).status,
            "submitted",
        )

    def test_an_expired_appointment_neither_prepares_nor_decides(self):
        expires_at = timezone.now() + timedelta(days=1)
        preparer, preparing = self.appoint(
            [CompanyCapability.PREPARE, CompanyCapability.APPROVE], expires_at=expires_at
        )
        proposal = self.prepare_as(preparer, preparing)
        later = expires_at + timedelta(seconds=1)
        with patch("tokens.services.register_authority.timezone.now", return_value=later):
            with self.assertRaises(NotFound):
                prepared(
                    preparer,
                    correction_payload(
                        self.issue, self.evidence, preparing, authority_evidence=proposal.authority_evidence_id
                    ),
                )
            with self.assertRaises(NotFound):
                decide(preparer, preparing, proposal, "approve")

    def test_an_approval_whose_approver_lost_the_appointment_must_be_given_again(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = self.prepared_by_the_owner()
        client = APIClient()
        client.force_authenticate(self.owner)

        def stage():
            return client.get(f"{CORRECTIONS}{proposal.pk}/").json()["stage"]

        decide(approver, approving, proposal, "approve")
        self.assertEqual(preview(self.owner, self.administrator, proposal, "apply")["unmet_requirements"], [])
        self.assertEqual(stage(), "approved")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        self.assertEqual(
            preview(self.owner, self.administrator, proposal, "apply")["unmet_requirements"], ["approval_lapsed"]
        )
        self.assertEqual(stage(), "submitted")
        with self.assertRaisesMessage(ValidationError, "approval_lapsed"):
            decide(self.owner, self.administrator, proposal, "apply")
        with self.assertRaisesMessage(ValidationError, "approval_required"):
            decide(self.owner, self.administrator, self.prepared_by_the_owner(), "apply")
        decide(self.owner, self.administrator, proposal, "approve")
        self.assertEqual(decide(self.owner, self.administrator, proposal, "apply").status, "applied")
        self.assertEqual(stage(), "applied")

    def test_the_issuer_identity_requirement_applies_to_every_register_command(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with use_migrate():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            upload_evidence(preparer, preparing, RegisterEvidenceKind.AUTHORITY)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            prepared(preparer, correction_payload(self.issue, self.evidence, preparing))
        with use_migrate():
            UserProfile.objects.filter(user=preparer).update(is_id_verified=True)
        proposal = self.prepare_as(preparer, preparing)
        self.assertEqual(proposal.submitted_by_id, preparer.pk)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            decide(self.owner, self.administrator, proposal, "approve")

    def test_a_retained_staff_era_correction_can_only_be_rejected(self):
        proposal = staff_era(self.prepared_by_the_owner())
        for kind in ("approve", "apply"):
            with self.subTest(kind=kind):
                self.assertIn(
                    "company_provided_evidence_required",
                    preview(self.owner, self.administrator, proposal, kind)["unmet_requirements"],
                )
                with self.assertRaisesMessage(ValidationError, "company_provided_evidence_required"):
                    decide(self.owner, self.administrator, proposal, kind)
        client = APIClient()
        client.force_authenticate(self.owner)
        self.assertEqual(client.get(f"{CORRECTIONS}{proposal.pk}/").json()["providedBy"], "staff_verified")
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        rejected = decide(approver, approving, proposal, "reject", "Prepare it again under the company process")
        self.assertEqual((rejected.status, rejected.reviewed_by_id), ("rejected", approver.pk))

    def test_evidence_whose_bytes_changed_is_refused_before_and_after_preparation(self):
        tampered = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY)
        with private_storage().open(tampered.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        with self.assertRaisesMessage(ValidationError, "no longer matches its record"):
            self.prepared_by_the_owner(authority_evidence=tampered.pk)
        proposal = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, proposal, "approve")
        with private_storage().open(proposal.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        self.assertEqual(
            preview(self.owner, self.administrator, proposal, "apply")["unmet_requirements"], ["evidence_unavailable"]
        )
        rejected = decide(self.owner, self.administrator, proposal, "reject", "The retained copy changed")
        self.assertEqual(rejected.status, "rejected")

    def test_an_identical_preparation_retry_returns_it_and_a_changed_one_conflicts(self):
        payload = correction_payload(self.issue, self.evidence, self.administrator)
        first, created = prepare_correction(actor=self.owner, **payload)
        again, repeated = prepare_correction(actor=self.owner, **payload)
        self.assertEqual((first.pk, created, again.pk, repeated), (first.pk, True, first.pk, False))
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        for actor, changes in (
            (self.owner, {"reason": "Changed"}),
            (self.owner, {"authority": "court_order", "approving_director": ""}),
            (preparer, {"appointment": preparing.pk}),
        ):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                prepare_correction(actor=actor, **{**payload, **changes})
        with use_operator():
            self.assertEqual(RegisterCorrection.objects.count(), 1)
        own = correction_payload(
            self.issue, upload_evidence(preparer, preparing, RegisterEvidenceKind.AUTHORITY), preparing
        )
        prepare_correction(actor=preparer, **own)
        revoke_company_appointment(requester=self.owner, appointment_id=preparing.pk)
        reappointed = self.reappoint(preparer, [CompanyCapability.PREPARE])
        with self.assertRaises(RegisterChangeConflict):
            prepare_correction(actor=preparer, **{**own, "appointment": reappointed.pk})
        with use_operator():
            self.assertEqual(RegisterCorrection.objects.count(), 2)

    def test_the_api_uploads_prepares_previews_and_decides(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        body = {
            "company_id": str(self.company.pk),
            "appointment": str(self.administrator.pk),
            "kind": RegisterEvidenceKind.AUTHORITY,
            "idempotency_key": str(uuid4()),
        }
        uploaded = client.post(
            EVIDENCE,
            {**body, "file": SimpleUploadedFile("resolution.pdf", DOCUMENT_BYTES, content_type="application/pdf")},
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        receipt = uploaded.json()
        self.assertEqual(
            (receipt["kind"], receipt["providedBy"], receipt["fileSize"]), ("authority", "company", len(DOCUMENT_BYTES))
        )
        changed = client.post(
            EVIDENCE,
            {**body, "file": SimpleUploadedFile("resolution.pdf", pdf_bytes(pages=2), content_type="application/pdf")},
            format="multipart",
        )
        self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator():
            evidence = RegisterEvidence.objects.get(pk=receipt["uuid"])
        payload = correction_payload(self.issue, evidence, self.administrator)
        payload["effective_on"] = payload["effective_on"].isoformat()
        created = client.post(CORRECTIONS, payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(client.post(CORRECTIONS, payload, format="json").status_code, 200)
        proposal = created.json()
        self.assertEqual(
            (proposal["stage"], proposal["providedBy"], proposal["authorityEvidence"], proposal["decisions"]),
            ("submitted", "company", receipt["uuid"], []),
        )
        detail = f"{CORRECTIONS}{proposal['uuid']}/"
        for kind in ("approve", "apply"):
            decision = {"appointment": str(self.administrator.pk), "kind": kind}
            previewed = client.post(f"{detail}decision-preview/", decision, format="json")
            self.assertEqual(previewed.status_code, 200, previewed.content)
            self.assertEqual(
                {key: value for key, value in previewed.json().items() if key != "previewDigest"},
                {
                    "unmetRequirements": [],
                    "canDecide": True,
                    "registerSequence": 2,
                    "originalChanges": self.issue.changes,
                    "changes": proposal["changes"],
                    "effectiveOn": payload["effective_on"],
                },
            )
            stale = client.post(
                f"{detail}decide/",
                {**decision, "idempotency_key": str(uuid4()), "preview_digest": "0" * 64, "confirmation": True},
                format="json",
            )
            self.assertEqual(stale.status_code, 409, stale.content)
            decided = client.post(
                f"{detail}decide/",
                {
                    **decision,
                    "idempotency_key": str(uuid4()),
                    "preview_digest": previewed.json()["previewDigest"],
                    "confirmation": True,
                },
                format="json",
            )
            self.assertEqual(decided.status_code, 200, decided.content)
        result = decided.json()
        self.assertEqual(
            (
                result["status"],
                result["stage"],
                [row["kind"] for row in result["decisions"]],
                result["decisions"][0]["decidedByName"],
            ),
            ("applied", "applied", ["approve", "apply"], "Synthetic register owner"),
        )
        refused = client.post(
            f"{detail}decide/",
            {
                "appointment": str(self.administrator.pk),
                "kind": "reject",
                "reason": "Too late",
                "idempotency_key": str(uuid4()),
                "preview_digest": "0" * 64,
                "confirmation": False,
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 400, refused.content)
        listed = client.get(CORRECTIONS, {"register": str(self.issue.register_id), "status": "applied"}).json()
        self.assertEqual([row["uuid"] for row in listed["results"]], [proposal["uuid"]])


class RegisterCorrectionDecisionGuardTest(CorrectionAuthorityFixture, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.proposal = self.prepared_by_the_owner()

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def evidence_row(self, kind):
        evidence_id = uuid4()
        with company_operation(self.owner, self.company.pk, "register_evidence"), atomic():
            RegisterEvidence.objects.create(
                uuid=evidence_id,
                company=self.company,
                kind=kind,
                uploaded_by=self.owner,
                appointment=self.administrator,
                idempotency_key=uuid4(),
                file=f"companies/{self.company.pk}/register-evidence/{evidence_id}/{uuid4()}.bin",
                original_filename="resolution.pdf",
                file_size=10,
                mime_type="application/pdf",
                sha256="a" * 64,
            )

    def test_the_database_admits_authority_uploads_and_no_other_new_kind(self):
        with self.assertRaises(RuntimeError), atomic():
            self.evidence_row(RegisterEvidenceKind.AUTHORITY)
            raise RuntimeError("rollback")
        self.assert_refused("current preparation authority", lambda: self.evidence_row("constitution"))

    def test_the_database_admits_only_exact_current_company_decisions(self):
        stranger = person(f"stranger-{uuid4()}@example.test")
        refused = "exact current company authority"
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "apply", self.owner, self.administrator))
        self.assert_refused(
            refused,
            lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator, digest="0" * 64),
        )
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "reject", self.owner, self.administrator))
        self.assert_refused(
            refused, lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator, reason="No")
        )
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "approve", stranger, self.administrator))
        with company_operation(self.owner, self.company.pk, "register_correction_apply"):
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                RegisterCorrectionDecision.objects.create(
                    register_correction=self.proposal,
                    kind="approve",
                    decided_by=self.owner,
                    appointment=self.administrator,
                    idempotency_key=uuid4(),
                    digest=decision_digest(self.proposal, "approve", self.owner, self.administrator),
                    decided_at=timezone.now(),
                )
        with company_operation(self.owner, uuid4(), "register_correction_approve"):
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                RegisterCorrectionDecision.objects.create(
                    register_correction=self.proposal,
                    kind="approve",
                    decided_by=self.owner,
                    appointment=self.administrator,
                    idempotency_key=uuid4(),
                    digest=decision_digest(self.proposal, "approve", self.owner, self.administrator),
                    decided_at=timezone.now(),
                )
        approval = forge_decision(self.proposal, "approve", self.owner, self.administrator)
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator))
        with company_operation(self.owner, self.company.pk, "register_correction_approve"):
            for write in (
                lambda: RegisterCorrectionDecision.objects.filter(pk=approval.pk).update(reason="Rewritten"),
                lambda: RegisterCorrectionDecision.objects.filter(pk=approval.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "append-only"), atomic():
                    write()

    def test_the_database_admits_a_decision_only_by_its_principal_of_a_known_kind_on_an_undecided_correction(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        refused = "exact current company authority"
        self.assert_refused(
            refused,
            lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator, decided_by=approver),
        )
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "other", self.owner, self.administrator))
        staff_era_proposal = staff_era(self.prepared_by_the_owner())
        self.assert_refused(
            refused, lambda: forge_decision(staff_era_proposal, "approve", self.owner, self.administrator)
        )
        decide(approver, approving, self.proposal, "reject", "Prepare it again")
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator))

    def test_the_database_admits_each_step_only_from_an_appointment_holding_it(self):
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        refused = "exact current company authority"
        for actor, appointment, kind, reason in (
            (reader, reading, "approve", ""),
            (preparer, preparing, "approve", ""),
            (applier, applying, "approve", ""),
            (preparer, preparing, "reject", "Not mine to reject"),
        ):
            with self.subTest(decided_by=actor.email, kind=kind):
                self.assert_refused(
                    refused, lambda: forge_decision(self.proposal, kind, actor, appointment, reason=reason)
                )
        forge_decision(self.proposal, "approve", approver, approving)
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "apply", approver, approving))
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_decision(self.proposal, "reject", approver, approving, reason="Mine to reject")
            raise RuntimeError("rollback")

    def test_the_database_admits_a_correction_only_from_its_preparers_own_authority_upload(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        theirs = self.prepare_as(preparer, preparing)
        forged = forged_fields(theirs)
        self.assert_refused(
            "exact current intent",
            lambda: insert_forged(
                forged, self.owner, submitted_by=self.owner, preparing_appointment=self.administrator
            ),
        )
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        self.assert_refused(
            "exact current intent",
            lambda: insert_forged(forged, reader, submitted_by=reader, preparing_appointment=reading),
        )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, preparer)
            raise RuntimeError("rollback")

    def test_the_database_admits_a_preparation_only_for_its_own_company_and_its_preparers_appointment(self):
        forged = forged_fields(self.proposal)
        refused = "exact current intent"
        self.assert_refused(refused, lambda: insert_forged(forged, self.owner, scope=uuid4()))
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        self.assert_refused(refused, lambda: insert_forged(forged, self.owner, preparing_appointment=reading))
        with use_operator():
            stranger, other_company, other_administrator, _, _ = correction_fixture()
        _, code, _ = issue_team_invitation(
            requester=stranger,
            company_id=other_company.pk,
            inviter_appointment_id=other_administrator.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.PREPARE],
            delegatable_capabilities=[],
            appointment_expires_at=None,
        )
        elsewhere = accept_team_invitation(
            requester=self.owner, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        foreign = upload_evidence(self.owner, elsewhere, RegisterEvidenceKind.AUTHORITY)
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            self.prepared_by_the_owner(authority_evidence=foreign.pk)
        self.assert_refused(
            refused,
            lambda: insert_forged(
                forged,
                self.owner,
                authority_evidence=foreign,
                evidence_fingerprint=foreign.sha256,
                evidence_snapshot=evidence_snapshot(foreign),
            ),
        )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner)
            raise RuntimeError("rollback")

    def test_the_database_refuses_an_application_whose_register_changed_after_its_preview(self):
        forge_decision(self.proposal, "approve", self.owner, self.administrator)
        with use_operator():
            stale = decision_digest(self.proposal, "apply", self.owner, self.administrator)
            record_entry(
                register_id=self.issue.register_id,
                operation_id=uuid4(),
                kind="issue",
                changes=self.issue.changes,
                effective_on=self.issue.effective_on,
                recorded_by=self.owner,
            )
            self.assertNotEqual(decision_digest(self.proposal, "apply", self.owner, self.administrator), stale)
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.proposal, "apply", self.owner, self.administrator, digest=stale),
        )

    def test_an_outcome_needs_its_own_decision_and_a_decision_needs_its_own_outcome(self):
        forge_decision(self.proposal, "approve", self.owner, self.administrator)
        with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), atomic():
            with company_operation(self.owner, self.company.pk, "register_correction_reject"), atomic():
                RegisterCorrection.objects.filter(pk=self.proposal.pk).update(
                    status="rejected", rejection_reason="Forged", reviewed_by=self.owner, reviewed_at=timezone.now()
                )
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(self.proposal, "reject", self.owner, self.administrator, reason="Without effect")
        with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), use_operator(), atomic():
            decision = forge_decision(self.proposal, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.proposal, self.owner, decision, status="rejected", rejection_reason="Different")
        with use_operator(), atomic():
            decision = forge_decision(self.proposal, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.proposal, self.owner, decision, status="rejected", rejection_reason="Exact")
        with use_operator():
            self.proposal.refresh_from_db()
        self.assertEqual((self.proposal.status, self.proposal.rejection_reason), ("rejected", "Exact"))

    def test_an_outcome_is_written_only_by_its_decider_at_its_decision_time_for_its_kind(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        refused = "Only the exact company decision"

        def outcome(actor, **fields):
            with company_operation(actor, self.company.pk, "register_correction_reject"), atomic():
                RegisterCorrection.objects.filter(pk=self.proposal.pk).update(**fields)

        with self.assertRaises(RuntimeError), use_operator(), atomic():
            decision = forge_decision(self.proposal, "reject", approver, approving, reason="Exact")
            rejected = {"status": "rejected", "rejection_reason": "Exact"}
            for actor, fields in (
                (self.owner, {**rejected, "reviewed_by": approver, "reviewed_at": decision.decided_at}),
                (self.owner, {**rejected, "reviewed_by": self.owner, "reviewed_at": decision.decided_at}),
                (approver, {**rejected, "reviewed_by": approver, "reviewed_at": timezone.now()}),
            ):
                with self.subTest(actor=actor.email), self.assertRaisesMessage(DatabaseError, refused), atomic():
                    outcome(actor, **fields)
            raise RuntimeError("rollback")
        approval = forge_decision(self.proposal, "approve", self.owner, self.administrator)
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            entry = record_entry(
                register_id=self.proposal.register_id,
                operation_id=self.proposal.pk,
                kind="correction",
                changes=self.proposal.changes,
                effective_on=self.proposal.effective_on,
                recorded_by=self.owner,
                corrects_id=self.proposal.corrects_id,
            )
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                with company_operation(self.owner, self.company.pk, "register_correction_apply"), atomic():
                    RegisterCorrection.objects.filter(pk=self.proposal.pk).update(
                        status="applied",
                        applied_entry=entry,
                        reviewed_by=self.owner,
                        reviewed_at=approval.decided_at,
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "submitted")

    def test_a_temporary_table_cannot_stand_in_for_the_decision_or_evidence_tables(self):
        operator = connection.ops.quote_name(settings.RLS_ROLES["operator"])
        decided_at = timezone.now()
        with use_migrate(), self.assertRaises(RuntimeError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(f"SET LOCAL ROLE {operator}")
                cursor.execute(
                    "CREATE TEMP TABLE tokens_registercorrectiondecision "
                    "(LIKE public.tokens_registercorrectiondecision) ON COMMIT DROP"
                )
                cursor.execute(
                    "INSERT INTO pg_temp.tokens_registercorrectiondecision (uuid, created_at, updated_at, "
                    "register_correction_id, kind, decided_by_id, appointment_id, idempotency_key, digest, reason, "
                    "decided_at) VALUES (%s, %s, %s, %s, 'reject', %s, %s, %s, %s, 'Forged', %s)",
                    [
                        uuid4(),
                        decided_at,
                        decided_at,
                        self.proposal.pk,
                        self.owner.pk,
                        self.administrator.pk,
                        uuid4(),
                        "0" * 64,
                        decided_at,
                    ],
                )
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, true), "
                    "set_config('app.company_operation', 'register_correction_reject', true), "
                    "set_config('app.company_id', %s, true)",
                    [str(self.owner.pk), str(self.company.pk)],
                )
                with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), atomic():
                    cursor.execute(
                        "UPDATE public.tokens_registercorrection SET status = 'rejected', "
                        "rejection_reason = 'Forged', reviewed_by_id = %s, reviewed_at = %s WHERE uuid = %s",
                        [self.owner.pk, decided_at, self.proposal.pk],
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "submitted")

    def test_the_owner_without_an_appointment_decides_nothing(self):
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        with self.assertRaises(NotFound):
            decide(self.owner, self.administrator, self.proposal, "approve")
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator),
        )


class ScopedRegisterCorrectionAuthorityTest(RunsOnTheScopedConnection, RegisterCorrectionAuthorityTest):
    pass


class ScopedRegisterCorrectionDecisionGuardTest(RunsOnTheScopedConnection, RegisterCorrectionDecisionGuardTest):
    pass
