from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connections
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
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterImportDecision,
)
from tokens.services.register_imports import decide_import, prepare_import
from tokens.tests.test_register_access import person
from tokens.tests.test_register_imports import (
    DOCUMENT_BYTES,
    decide,
    decision_digest,
    forge_decision,
    forge_outcome,
    forged_fields,
    import_fixture,
    import_payload,
    insert_forged,
    prepared,
    preview,
    staff_user,
    stated,
    upload_evidence,
)
from users.models import UserProfile

EVIDENCE = "/api/v1/tokens/register-evidence/"
IMPORTS = "/api/v1/tokens/register-imports/"


class AppointsTeam:
    def appoint(self, capabilities, *, expires_at=None):
        appointee = person(f"appointee-{uuid4()}@example.test")
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.administrator.pk,
            idempotency_key=uuid4(),
            capabilities=list(capabilities),
            delegatable_capabilities=[],
            appointment_expires_at=expires_at,
        )
        appointment = accept_team_invitation(
            requester=appointee, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        return appointee, appointment


class RegisterImportAuthorityTest(AppointsTeam, StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            (
                self.owner,
                self.company,
                self.token,
                self.member,
                self.administrator,
                self.register_copy,
                self.asic,
                _,
            ) = import_fixture()

    def prepare_as(self, actor, appointment, **changes):
        register_copy = upload_evidence(actor, appointment, RegisterEvidenceKind.SHARE_REGISTER)
        asic = upload_evidence(actor, appointment, RegisterEvidenceKind.ASIC_EXTRACT)
        return prepared(actor, import_payload(self.token, register_copy, asic, self.member, appointment, **changes))

    def staff_era_import(self):
        proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator)
        )
        with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("ALTER TABLE tokens_registerimport DISABLE TRIGGER tokens_register_import_identity")
            try:
                RegisterImport.objects.filter(pk=proposal.pk).update(
                    preparing_appointment=None,
                    register_evidence=None,
                    asic_evidence=None,
                    asic_snapshot=None,
                    asic_file="",
                    source_document=uuid4(),
                    asic_document=uuid4(),
                    asic_issued_total=None,
                    asic_member_count=None,
                )
            finally:
                cursor.execute("ALTER TABLE tokens_registerimport ENABLE TRIGGER tokens_register_import_identity")
        with use_operator():
            proposal.refresh_from_db()
        return proposal

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
        ):
            with self.subTest(actor=actor.email, kind=kind):
                self.assertIn(
                    "appointment_capability_required",
                    preview(actor, appointment, proposal, kind, "No" if kind == "reject" else "")["unmet_requirements"],
                )
        decide(approver, approving, proposal, "approve")
        applied = decide(applier, applying, proposal, "apply")
        with use_operator():
            decisions = [
                (row.kind, row.decided_by_id, row.appointment_id) for row in applied.decisions.order_by("decided_at")
            ]
        self.assertEqual(decisions, [("approve", approver.pk, approving.pk), ("apply", applier.pk, applying.pk)])
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", applier.pk))

    def test_an_administrator_alone_prepares_approves_and_applies(self):
        proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator)
        )
        decide(self.owner, self.administrator, proposal, "approve")
        self.assertEqual(decide(self.owner, self.administrator, proposal, "apply").status, "applied")

    def test_appointments_without_preparation_and_platform_roles_prepare_nothing(self):
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        finance, financing = self.appoint([CompanyCapability.FINANCE])
        staff = staff_user()
        for actor, appointment in ((reader, reading), (finance, financing), (staff, self.administrator)):
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                upload_evidence(actor, appointment, RegisterEvidenceKind.SHARE_REGISTER)
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                prepared(actor, import_payload(self.token, self.register_copy, self.asic, self.member, appointment))
        with use_operator():
            self.assertFalse(RegisterImport.objects.exists())

    def test_only_the_preparers_own_evidence_for_this_company_can_be_used(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with self.assertRaisesMessage(ValidationError, "you uploaded for this company"):
            prepared(preparer, import_payload(self.token, self.register_copy, self.asic, self.member, preparing))
        with use_operator():
            stranger, _, _, _, foreign_administrator, foreign_register, foreign_asic, _ = import_fixture()
        with self.assertRaisesMessage(ValidationError, "you uploaded for this company"):
            prepared(
                self.owner, import_payload(self.token, foreign_register, foreign_asic, self.member, self.administrator)
            )
        with self.assertRaises(NotFound):
            prepared(
                stranger,
                import_payload(self.token, foreign_register, foreign_asic, self.member, foreign_administrator),
            )
        with use_operator():
            self.assertFalse(RegisterImport.objects.exists())

    def test_revocation_after_a_preview_refuses_the_decision_and_records_nothing(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator)
        )
        digest = preview(approver, approving, proposal, "approve")["preview_digest"]
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        with self.assertRaises(NotFound):
            decide_import(
                actor=approver,
                import_id=proposal.pk,
                appointment=approving.pk,
                kind="approve",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with use_operator():
            self.assertFalse(RegisterImportDecision.objects.exists())

    def test_an_expired_appointment_neither_prepares_nor_decides(self):
        expires_at = timezone.now() + timedelta(days=1)
        preparer, preparing = self.appoint(
            [CompanyCapability.PREPARE, CompanyCapability.APPROVE], expires_at=expires_at
        )
        proposal = self.prepare_as(preparer, preparing)
        later = expires_at + timedelta(seconds=1)
        with patch("tokens.services.register_authority.timezone.now", return_value=later):
            with self.assertRaises(NotFound):
                self.prepare_as(preparer, preparing, operation_id=uuid4())
            with self.assertRaises(NotFound):
                decide(preparer, preparing, proposal, "approve")

    def test_an_approval_whose_approver_lost_the_appointment_must_be_given_again(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator)
        )
        client = APIClient()
        client.force_authenticate(self.owner)

        def stage():
            return client.get(f"{IMPORTS}{proposal.pk}/").json()["stage"]

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
        decide(self.owner, self.administrator, proposal, "approve")
        self.assertEqual(decide(self.owner, self.administrator, proposal, "apply").status, "applied")

    def test_the_issuer_identity_requirement_applies_to_every_register_command(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with use_migrate():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            upload_evidence(preparer, preparing, RegisterEvidenceKind.SHARE_REGISTER)
        with use_migrate():
            UserProfile.objects.filter(user=preparer).update(is_id_verified=True)
        self.assertEqual(self.prepare_as(preparer, preparing).submitted_by_id, preparer.pk)

    def test_a_retained_staff_era_import_can_only_be_rejected(self):
        proposal = self.staff_era_import()
        for kind in ("approve", "apply"):
            with self.subTest(kind=kind):
                self.assertIn(
                    "company_provided_evidence_required",
                    preview(self.owner, self.administrator, proposal, kind)["unmet_requirements"],
                )
                with self.assertRaisesMessage(ValidationError, "company_provided_evidence_required"):
                    decide(self.owner, self.administrator, proposal, kind)
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        rejected = decide(approver, approving, proposal, "reject", "Prepare it again under the company process")
        self.assertEqual((rejected.status, rejected.reviewed_by_id), ("rejected", approver.pk))

    def test_evidence_whose_bytes_changed_is_refused_before_and_after_preparation(self):
        tampered = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SHARE_REGISTER)
        with private_storage().open(tampered.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        with self.assertRaisesMessage(ValidationError, "no longer matches its record"):
            prepared(self.owner, import_payload(self.token, tampered, self.asic, self.member, self.administrator))
        proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator)
        )
        with private_storage().open(proposal.asic_file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        self.assertIn(
            "evidence_unavailable", preview(self.owner, self.administrator, proposal, "approve")["unmet_requirements"]
        )

    def test_an_identical_preparation_retry_returns_it_and_a_changed_one_conflicts(self):
        payload = stated(import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator))
        first, created = prepare_import(actor=self.owner, **payload)
        again, repeated = prepare_import(actor=self.owner, **payload)
        self.assertEqual((first.pk, created, again.pk, repeated), (first.pk, True, first.pk, False))
        with self.assertRaises(RegisterChangeConflict):
            prepare_import(actor=self.owner, **{**payload, "as_at": (timezone.localdate() - timedelta(days=400))})
        with use_operator():
            self.assertEqual(RegisterImport.objects.count(), 1)

    def test_the_api_uploads_prepares_previews_decides_and_serves_the_asic_copy(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        receipts = {}
        for kind in (RegisterEvidenceKind.SHARE_REGISTER, RegisterEvidenceKind.ASIC_EXTRACT):
            body = {
                "company_id": str(self.company.pk),
                "appointment": str(self.administrator.pk),
                "kind": kind,
                "idempotency_key": str(uuid4()),
            }
            response = client.post(
                EVIDENCE,
                {**body, "file": SimpleUploadedFile(f"{kind}.pdf", DOCUMENT_BYTES, content_type="application/pdf")},
                format="multipart",
            )
            self.assertEqual(response.status_code, 201, response.content)
            receipts[kind] = response.json()
            self.assertEqual(
                (receipts[kind]["kind"], receipts[kind]["providedBy"], receipts[kind]["fileSize"]),
                (kind, "company", len(DOCUMENT_BYTES)),
            )
            replay = client.post(
                EVIDENCE,
                {**body, "file": SimpleUploadedFile(f"{kind}.pdf", DOCUMENT_BYTES, content_type="application/pdf")},
                format="multipart",
            )
            self.assertEqual((replay.status_code, replay.json()["uuid"]), (200, receipts[kind]["uuid"]))
            changed = client.post(
                EVIDENCE,
                {
                    **body,
                    "file": SimpleUploadedFile(f"{kind}.pdf", pdf_bytes(pages=2), content_type="application/pdf"),
                },
                format="multipart",
            )
            self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator():
            uploaded = {kind: RegisterEvidence.objects.get(pk=receipt["uuid"]) for kind, receipt in receipts.items()}
        payload = stated(
            import_payload(
                self.token,
                uploaded[RegisterEvidenceKind.SHARE_REGISTER],
                uploaded[RegisterEvidenceKind.ASIC_EXTRACT],
                self.member,
                self.administrator,
            )
        )
        created = client.post(IMPORTS, payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(client.post(IMPORTS, payload, format="json").status_code, 200)
        self.assertEqual(client.post(IMPORTS, {**payload, "reason": "Changed"}, format="json").status_code, 409)
        proposal = created.json()
        self.assertEqual(
            (proposal["stage"], proposal["providedBy"], proposal["preparedByName"], proposal["decisions"]),
            ("submitted", "company", "Synthetic register owner", []),
        )
        detail = f"{IMPORTS}{proposal['uuid']}/"
        for kind in ("approve", "apply"):
            body = {"appointment": str(self.administrator.pk), "kind": kind}
            previewed = client.post(f"{detail}decision-preview/", body, format="json")
            self.assertEqual(previewed.status_code, 200, previewed.content)
            self.assertTrue(previewed.json()["canDecide"])
            decided = client.post(
                f"{detail}decide/",
                {
                    **body,
                    "idempotency_key": str(uuid4()),
                    "preview_digest": previewed.json()["previewDigest"],
                    "confirmation": True,
                },
                format="json",
            )
            self.assertEqual(decided.status_code, 200, decided.content)
        result = decided.json()
        self.assertEqual(
            (result["status"], [row["kind"] for row in result["decisions"]], result["decisions"][0]["decidedByName"]),
            ("applied", ["approve", "apply"], "Synthetic register owner"),
        )
        self.assertEqual(client.get(f"{detail}asic-file/").status_code, 200)
        listed = client.get(IMPORTS, {"token": str(self.token.pk), "status": "applied"}).json()["results"]
        self.assertEqual([row["uuid"] for row in listed], [proposal["uuid"]])
        self.assertEqual(client.get(IMPORTS, {"status": "submitted"}).json()["results"], [])


class RegisterImportDecisionGuardTest(AppointsTeam, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            (
                self.owner,
                self.company,
                self.token,
                self.member,
                self.administrator,
                self.register_copy,
                self.asic,
                _,
            ) = import_fixture()
        self.proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.administrator)
        )

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def evidence_row(self, operation="register_evidence", actor=None, appointment=None, **changes):
        evidence_id = uuid4()
        actor = actor or self.owner
        fields = {
            "uuid": evidence_id,
            "company": self.company,
            "kind": RegisterEvidenceKind.SHARE_REGISTER,
            "uploaded_by": actor,
            "appointment": appointment or self.administrator,
            "idempotency_key": uuid4(),
            "file": f"companies/{self.company.pk}/register-evidence/{evidence_id}/{uuid4()}.bin",
            "original_filename": "register.pdf",
            "file_size": 10,
            "mime_type": "application/pdf",
            "sha256": "a" * 64,
            **changes,
        }
        with company_operation(actor, self.company.pk, operation), atomic():
            RegisterEvidence.objects.create(**fields)

    def test_the_database_admits_only_exact_company_provided_evidence(self):
        reader = person(f"reader-{uuid4()}@example.test")
        for changes in (
            {"uploaded_by": reader},
            {"sha256": "not a digest"},
            {"mime_type": "text/html"},
            {"file": f"companies/{self.company.pk}/elsewhere/{uuid4()}.bin"},
            {"kind": "constitution"},
        ):
            with self.subTest(changes=changes):
                self.assert_refused("current preparation authority", lambda: self.evidence_row(**changes))
        self.assert_refused("current preparation authority", lambda: self.evidence_row(operation="document_create"))
        with self.assertRaises(RuntimeError), atomic():
            self.evidence_row()
            raise RuntimeError("rollback")
        unused = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.ASIC_EXTRACT)
        with company_operation(self.owner, self.company.pk, "register_evidence"):
            for write in (
                lambda: RegisterEvidence.objects.filter(pk=self.register_copy.pk).update(sha256="b" * 64),
                lambda: RegisterEvidence.objects.filter(pk=unused.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "Retain company-provided register evidence"), atomic():
                    write()

    def test_the_database_admits_only_exact_current_company_decisions(self):
        stranger = person(f"stranger-{uuid4()}@example.test")
        refused = "exact current company authority"
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "apply", self.owner, self.administrator))
        self.assert_refused(
            refused, lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator, digest="0" * 64)
        )
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "reject", self.owner, self.administrator))
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "approve", stranger, self.administrator))
        with company_operation(self.owner, self.company.pk, "register_import_apply"):
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                RegisterImportDecision.objects.create(
                    register_import=self.proposal,
                    kind="approve",
                    decided_by=self.owner,
                    appointment=self.administrator,
                    idempotency_key=uuid4(),
                    digest=decision_digest(self.proposal, "approve", self.owner, self.administrator),
                    decided_at=timezone.now(),
                )
        approval = forge_decision(self.proposal, "approve", self.owner, self.administrator)
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator))
        with company_operation(self.owner, self.company.pk, "register_import_approve"):
            for write in (
                lambda: RegisterImportDecision.objects.filter(pk=approval.pk).update(reason="Rewritten"),
                lambda: RegisterImportDecision.objects.filter(pk=approval.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "append-only"), atomic():
                    write()

    def test_the_database_admits_each_step_only_from_an_appointment_holding_it(self):
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        for actor, appointment in ((reader, reading), (approver, approving)):
            with self.subTest(upload_by=actor.email):
                self.assert_refused(
                    "current preparation authority",
                    lambda: self.evidence_row(actor=actor, appointment=appointment),
                )
        with self.assertRaises(RuntimeError), atomic():
            self.evidence_row(actor=preparer, appointment=preparing)
            raise RuntimeError("rollback")
        refused = "exact current company authority"
        for actor, appointment, kind, reason in (
            (reader, reading, "approve", ""),
            (preparer, preparing, "approve", ""),
            (preparer, preparing, "reject", "Not mine to reject"),
        ):
            with self.subTest(decided_by=actor.email, kind=kind):
                self.assert_refused(
                    refused, lambda: forge_decision(self.proposal, kind, actor, appointment, reason=reason)
                )
        with self.assertRaises(RuntimeError), atomic():
            forge_decision(self.proposal, "approve", approver, approving)
            raise RuntimeError("rollback")

    def test_the_database_admits_an_import_only_from_its_preparers_own_uploads(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        theirs = prepared(
            preparer,
            import_payload(
                self.token,
                upload_evidence(preparer, preparing, RegisterEvidenceKind.SHARE_REGISTER),
                upload_evidence(preparer, preparing, RegisterEvidenceKind.ASIC_EXTRACT),
                self.member,
                preparing,
            ),
        )
        forged = forged_fields(theirs)
        mine = forged_fields(self.proposal)
        register_copy = ("register_evidence", "evidence_fingerprint", "evidence_snapshot")
        asic_copy = ("asic_evidence", "asic_fingerprint", "asic_snapshot")
        for borrowed in (register_copy + asic_copy, register_copy, asic_copy):
            with self.subTest(borrowed=borrowed):
                self.assert_refused(
                    "exact current intent",
                    lambda: insert_forged({**mine, **{name: forged[name] for name in borrowed}}, self.owner),
                )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, preparer)
            insert_forged(mine, self.owner)
            raise RuntimeError("rollback")

    def test_an_outcome_needs_its_own_decision_and_a_decision_needs_its_own_outcome(self):
        forge_decision(self.proposal, "approve", self.owner, self.administrator)
        with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), atomic():
            with company_operation(self.owner, self.company.pk, "register_import_reject"), atomic():
                RegisterImport.objects.filter(pk=self.proposal.pk).update(
                    status="rejected", rejection_reason="Forged", reviewed_by=self.owner, reviewed_at=timezone.now()
                )
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(self.proposal, "reject", self.owner, self.administrator, reason="Without effect")
        with use_operator(), atomic():
            decision = forge_decision(self.proposal, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.proposal, self.owner, decision, status="rejected", rejection_reason="Exact")
        with use_operator():
            self.proposal.refresh_from_db()
        self.assertEqual((self.proposal.status, self.proposal.rejection_reason), ("rejected", "Exact"))

    def test_the_owner_without_an_appointment_decides_nothing(self):
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        with self.assertRaises(NotFound):
            decide(self.owner, self.administrator, self.proposal, "approve")
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator),
        )


class ScopedRegisterImportAuthorityTest(RunsOnTheScopedConnection, RegisterImportAuthorityTest):
    pass


class ScopedRegisterImportDecisionGuardTest(RunsOnTheScopedConnection, RegisterImportDecisionGuardTest):
    pass
