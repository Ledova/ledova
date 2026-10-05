from datetime import date, timedelta
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connection, connections
from django.test import override_settings
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
from companies.tests.test_document_file_access import DOCUMENT_BYTES
from operators.models import Operator
from shared.db import MIGRATE_ALIAS, atomic, current_alias, use_migrate, use_operator
from shared.storage import private_storage
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterOpeningDecision,
    ShareRegister,
    ShareToken,
)
from tokens.services import register_openings
from tokens.services.register_authority import APPOINTMENT_NOT_FOUND
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_evidence import evidence_snapshot
from tokens.services.register_openings import decide_opening, prepare_opening
from tokens.tests.evidence_fixtures import staff_user, upload_evidence
from tokens.tests.test_register_access import person
from tokens.tests.test_register_acknowledgement_authority import locked
from tokens.tests.test_register_corrections import correction_fixture
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_openings import (
    SETTINGS,
    decide,
    decision_digest,
    forge_decision,
    forge_outcome,
    forged_fields,
    insert_forged,
    opening_fixture,
    opening_payload,
    prepared,
    preview,
    reading,
    staff_era,
)
from users.models import UserProfile

EVIDENCE = "/api/v1/tokens/register-evidence/"
OPENINGS = "/api/v1/tokens/register-openings/"


class OpeningAuthorityFixture(AppointsTeam):
    def setUp(self):
        self.enterContext(override_settings(**SETTINGS))
        with use_operator():
            self.tenant, self.owner, self.administrator, self.evidence, self.target, self.node = opening_fixture()
        self.company = self.tenant.company
        reading(self, self.node)

    def payload(self, evidence, appointment, **changes):
        return opening_payload(self.target.token_id, evidence, appointment, **changes)

    def prepare_as(self, actor, appointment, **changes):
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        return prepared(actor, self.payload(evidence, appointment, **changes))

    def prepared_by_the_owner(self, **changes):
        return prepared(self.owner, self.payload(self.evidence, self.administrator, **changes))


class RegisterOpeningAuthorityTest(OpeningAuthorityFixture, StubUploadDependencies, APITransactionTestCase):
    def test_each_step_takes_its_own_capability_or_administration_and_one_person_may_take_every_step(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        proposal = self.prepare_as(preparer, preparing)
        self.assertEqual((proposal.submitted_by_id, proposal.preparing_appointment_id), (preparer.pk, preparing.pk))
        get_block = self.node.client.w3.eth.get_block
        get_block.reset_mock()
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
        get_block.assert_not_called()
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

    def test_the_chain_is_read_only_outside_transactions(self):
        held = []
        read = self.node.block

        def recording(identifier):
            held.append(any(connections[alias].in_atomic_block for alias in connections))
            return read(identifier)

        self.node.client.w3.eth.get_block.side_effect = recording
        proposal = self.prepared_by_the_owner()
        reads = [len(held)]
        for kind in ("approve", "apply"):
            decide(self.owner, self.administrator, proposal, kind)
            reads.append(len(held))
        self.assertTrue(0 < reads[0] < reads[1] < reads[2], reads)
        self.assertNotIn(True, held)

    def test_an_application_is_recorded_under_the_company_and_share_class_locks(self):
        probe = connections[MIGRATE_ALIAS].copy(alias="opening-lock-probe")
        self.addCleanup(probe.close)
        proposal = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, proposal, "approve")
        check = register_openings._check_uninitialized
        observed = []

        def probed(token):
            observed.append(locked(probe, self.company, self.tenant.token))
            return check(token)

        with patch.object(register_openings, "_check_uninitialized", side_effect=probed):
            self.assertEqual(decide(self.owner, self.administrator, proposal, "apply").status, "applied")
        self.assertEqual(observed, [(True, True)])
        self.assertEqual(locked(probe, self.company, self.tenant.token), (False, False))

    def test_appointments_without_preparation_and_platform_roles_prepare_nothing(self):
        reader, reading_appointment = self.appoint([CompanyCapability.READ_REGISTER])
        finance, financing = self.appoint([CompanyCapability.FINANCE])
        staff = staff_user()
        get_block = self.node.client.w3.eth.get_block
        get_block.reset_mock()
        for actor, appointment in ((reader, reading_appointment), (finance, financing), (staff, self.administrator)):
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                prepared(actor, self.payload(self.evidence, appointment))
        with self.assertRaisesMessage(NotFound, APPOINTMENT_NOT_FOUND):
            prepared(self.owner, self.payload(self.evidence, reading_appointment))
        get_block.assert_not_called()
        with use_operator():
            self.assertFalse(RegisterOpening.objects.exists())

    def test_only_the_preparers_own_authority_upload_for_this_company_can_be_used(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            prepared(preparer, self.payload(self.evidence, preparing))
        register_copy = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SHARE_REGISTER)
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            self.prepared_by_the_owner(authority_evidence=register_copy.pk)
        with use_operator():
            stranger, _, foreign_administrator, _, foreign_evidence = correction_fixture()
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            self.prepared_by_the_owner(authority_evidence=foreign_evidence.pk)
        with self.assertRaisesMessage(NotFound, "Share class not found"):
            prepared(stranger, self.payload(foreign_evidence, foreign_administrator))
        proposal = self.prepared_by_the_owner()
        with self.assertRaisesMessage(NotFound, "Register opening not found"):
            preview(stranger, foreign_administrator, proposal, "approve")
        with use_operator():
            self.assertEqual(list(RegisterOpening.objects.values_list("pk", flat=True)), [proposal.pk])

    def test_revocation_after_a_preview_refuses_the_decision_and_records_nothing(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = self.prepared_by_the_owner()
        digest = preview(approver, approving, proposal, "approve")["preview_digest"]
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        with self.assertRaises(NotFound):
            decide_opening(
                actor=approver,
                opening_id=proposal.pk,
                appointment=approving.pk,
                kind="approve",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with use_operator():
            self.assertFalse(RegisterOpeningDecision.objects.exists())

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

    def test_a_preview_binds_its_opening_appointment_and_reason(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = self.prepared_by_the_owner()
        other = prepared(
            self.owner,
            self.payload(
                upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY), self.administrator
            ),
        )

        def decided(opening, appointment, kind, digest, reason=""):
            return decide_opening(
                actor=approver,
                opening_id=opening.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
                reason=reason,
            )

        approval = preview(approver, approving, proposal, "approve")["preview_digest"]
        rejection = preview(approver, approving, proposal, "reject", "The resolution was withdrawn")["preview_digest"]
        with self.subTest(bound="opening"), self.assertRaises(RegisterChangeConflict):
            decided(other, approving, "approve", approval)
        with self.subTest(bound="reason"), self.assertRaises(RegisterChangeConflict):
            decided(proposal, approving, "reject", rejection, "Another reason")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        reappointed = self.reappoint(approver, [CompanyCapability.APPROVE])
        with self.subTest(bound="appointment"), self.assertRaises(RegisterChangeConflict):
            decided(proposal, reappointed, "approve", approval)
        with use_operator():
            self.assertFalse(RegisterOpeningDecision.objects.exists())
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
                    self.payload(self.evidence, preparing, authority_evidence=proposal.authority_evidence_id),
                )
            with self.assertRaises(NotFound):
                decide(preparer, preparing, proposal, "approve")

    def test_an_approval_whose_approver_lost_the_appointment_must_be_given_again(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = self.prepared_by_the_owner()
        client = APIClient()
        client.force_authenticate(self.owner)

        def stage():
            return client.get(f"{OPENINGS}{proposal.pk}/").json()["stage"]

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
            prepared(preparer, self.payload(self.evidence, preparing))
        with use_migrate():
            UserProfile.objects.filter(user=preparer).update(is_id_verified=True)
        proposal = self.prepare_as(preparer, preparing)
        self.assertEqual(proposal.submitted_by_id, preparer.pk)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            decide(self.owner, self.administrator, proposal, "approve")

    def test_a_retained_staff_era_opening_can_only_be_rejected_whether_or_not_it_was_reviewed(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        reviewed = staff_era(self.prepared_by_the_owner())
        unreviewed = staff_era(self.prepared_by_the_owner(), boundary=None)
        self.assertIsNone(unreviewed.boundary)
        self.node.client.w3.eth.get_block.side_effect = RuntimeError("provider offline")
        for proposal in (reviewed, unreviewed):
            for kind in ("approve", "apply"):
                with self.subTest(boundary=proposal.boundary is not None, kind=kind):
                    self.assertIn(
                        "company_provided_evidence_required",
                        preview(self.owner, self.administrator, proposal, kind)["unmet_requirements"],
                    )
                    with self.assertRaisesMessage(ValidationError, "company_provided_evidence_required"):
                        decide(self.owner, self.administrator, proposal, kind)
            self.assertEqual(client.get(f"{OPENINGS}{proposal.pk}/").json()["providedBy"], "staff_verified")
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
        payload = self.payload(self.evidence, self.administrator)
        first, created = prepare_opening(actor=self.owner, **payload)
        again, repeated = prepare_opening(actor=self.owner, **payload)
        self.assertEqual((first.pk, created, again.pk, repeated), (first.pk, True, first.pk, False))
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        other = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY)
        with use_migrate():
            other_class = ShareToken.objects.create(
                company=self.company, name="Synthetic preference shares", symbol="OPNP", total_supply="1000"
            )
        for actor, changes in (
            (self.owner, {"reason": "Changed"}),
            (self.owner, {"authority": "court_order", "approving_director": ""}),
            (self.owner, {"authority_evidence": other.pk}),
            (self.owner, {"token_id": other_class.pk}),
            (self.owner, {"mapping": [{**payload["mapping"][0], "member": str(uuid4())}, payload["mapping"][1]]}),
            (preparer, {"appointment": preparing.pk}),
        ):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                prepare_opening(actor=actor, **{**payload, **changes})
        with use_operator():
            self.assertEqual(RegisterOpening.objects.count(), 1)
        own = self.payload(upload_evidence(preparer, preparing, RegisterEvidenceKind.AUTHORITY), preparing)
        prepare_opening(actor=preparer, **own)
        revoke_company_appointment(requester=self.owner, appointment_id=preparing.pk)
        reappointed = self.reappoint(preparer, [CompanyCapability.PREPARE])
        with self.assertRaises(RegisterChangeConflict):
            prepare_opening(actor=preparer, **{**own, "appointment": reappointed.pk})
        with use_operator():
            self.assertEqual(RegisterOpening.objects.count(), 2)

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
        payload = self.payload(evidence, self.administrator)
        created = client.post(OPENINGS, payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(client.post(OPENINGS, payload, format="json").status_code, 200)
        proposal = created.json()
        self.assertEqual(
            (proposal["stage"], proposal["providedBy"], proposal["authorityEvidence"], proposal["decisions"]),
            ("submitted", "company", receipt["uuid"], []),
        )
        changes = sorted(
            [
                {"member": payload["mapping"][0]["member"], "shares": "80"},
                {"member": payload["mapping"][1]["member"], "shares": "20"},
            ],
            key=lambda change: change["member"],
        )
        detail = f"{OPENINGS}{proposal['uuid']}/"
        for kind in ("approve", "apply"):
            decision = {"appointment": str(self.administrator.pk), "kind": kind}
            previewed = client.post(f"{detail}decision-preview/", decision, format="json")
            self.assertEqual(previewed.status_code, 200, previewed.content)
            self.assertEqual(
                {key: value for key, value in previewed.json().items() if key != "previewDigest"},
                {
                    "unmetRequirements": [],
                    "canDecide": True,
                    "changes": changes,
                    "effectiveOn": proposal["boundarySummary"]["date"],
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
            ("applied", "applied", ["approve", "apply"], "opening owner"),
        )
        self.node.client.w3.eth.get_block.side_effect = RuntimeError("provider offline")
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
        listed = client.get(OPENINGS, {"token": str(self.tenant.token.pk), "status": "applied"}).json()
        self.assertEqual([row["uuid"] for row in listed["results"]], [proposal["uuid"]])

    def test_an_unreadable_chain_answers_the_api_with_service_unavailable(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        proposal = self.prepared_by_the_owner()
        self.node.client.w3.eth.get_block.side_effect = RuntimeError("private endpoint response")
        decision = {"appointment": str(self.administrator.pk), "kind": "approve"}
        previewed = client.post(f"{OPENINGS}{proposal.pk}/decision-preview/", decision, format="json")
        self.assertEqual(previewed.status_code, 503, previewed.content)
        self.assertNotIn(b"private endpoint", previewed.content)
        prepared_again = client.post(OPENINGS, self.payload(self.evidence, self.administrator), format="json")
        self.assertEqual(prepared_again.status_code, 503, prepared_again.content)


class RegisterOpeningDecisionGuardTest(OpeningAuthorityFixture, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.proposal = self.prepared_by_the_owner()

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

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
        for operation, scope in (("register_opening_apply", self.company.pk), ("register_opening_approve", uuid4())):
            with self.subTest(operation=operation), company_operation(self.owner, scope, operation):
                with self.assertRaisesMessage(DatabaseError, refused), atomic():
                    RegisterOpeningDecision.objects.create(
                        register_opening=self.proposal,
                        kind="approve",
                        decided_by=self.owner,
                        appointment=self.administrator,
                        idempotency_key=uuid4(),
                        digest=decision_digest(self.proposal, "approve", self.owner, self.administrator),
                        decided_at=timezone.now(),
                    )
        approval = forge_decision(self.proposal, "approve", self.owner, self.administrator)
        self.assert_refused(refused, lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator))
        with company_operation(self.owner, self.company.pk, "register_opening_approve"):
            for write in (
                lambda: RegisterOpeningDecision.objects.filter(pk=approval.pk).update(reason="Rewritten"),
                lambda: RegisterOpeningDecision.objects.filter(pk=approval.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "append-only"), atomic():
                    write()

    def test_the_database_admits_a_decision_only_by_its_principal_of_a_known_kind_on_an_undecided_opening(self):
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
        reader, reading_appointment = self.appoint([CompanyCapability.READ_REGISTER])
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        refused = "exact current company authority"
        for actor, appointment, kind, reason in (
            (reader, reading_appointment, "approve", ""),
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

    def test_the_database_admits_an_opening_only_from_its_preparers_own_authority_upload(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        theirs = self.prepare_as(preparer, preparing)
        forged = forged_fields(theirs)
        self.assert_refused(
            "exact current intent",
            lambda: insert_forged(
                forged, self.owner, submitted_by=self.owner, preparing_appointment=self.administrator
            ),
        )
        reader, reading_appointment = self.appoint([CompanyCapability.READ_REGISTER])
        self.assert_refused(
            "exact current intent",
            lambda: insert_forged(forged, reader, submitted_by=reader, preparing_appointment=reading_appointment),
        )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, preparer)
            raise RuntimeError("rollback")

    def test_the_database_admits_a_preparation_only_for_its_own_company_and_its_preparers_appointment(self):
        forged = forged_fields(self.proposal)
        refused = "exact current intent"
        self.assert_refused(refused, lambda: insert_forged(forged, self.owner, scope=uuid4()))
        reader, reading_appointment = self.appoint([CompanyCapability.READ_REGISTER])
        self.assert_refused(
            refused, lambda: insert_forged(forged, self.owner, preparing_appointment=reading_appointment)
        )
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

    def test_the_decision_digest_binds_the_boundary_block_and_for_application_the_class_register(self):
        with use_operator():
            approval, application = (
                decision_digest(self.proposal, kind, self.owner, self.administrator) for kind in ("approve", "apply")
            )
        block = {**self.proposal.boundary["block"], "hash": "0x" + "ab" * 32}
        with self.assertRaises(RuntimeError), use_migrate(), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("ALTER TABLE tokens_registeropening DISABLE TRIGGER USER")
            RegisterOpening.objects.filter(pk=self.proposal.pk).update(
                boundary={**self.proposal.boundary, "block": block}
            )
            self.assertNotEqual(decision_digest(self.proposal, "approve", self.owner, self.administrator), approval)
            raise RuntimeError("rollback")
        forge_decision(self.proposal, "approve", self.owner, self.administrator)
        with use_operator():
            self.assertEqual(decision_digest(self.proposal, "apply", self.owner, self.administrator), application)
            ShareRegister.objects.create(token_id=self.proposal.token_id, company_id=self.proposal.company_id)
            self.assertNotEqual(decision_digest(self.proposal, "apply", self.owner, self.administrator), application)
            self.assertEqual(decision_digest(self.proposal, "approve", self.owner, self.administrator), approval)
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.proposal, "apply", self.owner, self.administrator, digest=application),
        )

    def test_an_outcome_needs_its_own_decision_and_a_decision_needs_its_own_outcome(self):
        forge_decision(self.proposal, "approve", self.owner, self.administrator)
        with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), atomic():
            with company_operation(self.owner, self.company.pk, "register_opening_reject"), atomic():
                RegisterOpening.objects.filter(pk=self.proposal.pk).update(
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

    def test_an_approval_cannot_commit_with_its_opening_decided_in_the_same_transaction(self):
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(self.proposal, "approve", self.owner, self.administrator)
            decision = forge_decision(self.proposal, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.proposal, self.owner, decision, status="rejected", rejection_reason="Exact")
        with use_operator():
            self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "submitted")
            self.assertFalse(RegisterOpeningDecision.objects.exists())

    def test_an_outcome_is_written_only_by_its_decider_at_its_decision_time_for_its_kind(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        refused = "Only the exact company decision"

        def outcome(actor, **fields):
            with company_operation(actor, self.company.pk, "register_opening_reject"), atomic():
                RegisterOpening.objects.filter(pk=self.proposal.pk).update(**fields)

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
            register = ShareRegister.objects.create(
                token_id=self.proposal.token_id, company_id=self.proposal.company_id
            )
            entry = record_entry(
                register_id=register.pk,
                operation_id=self.proposal.pk,
                kind="opening",
                changes=[],
                effective_on=timezone.now().date(),
                recorded_by=self.owner,
            )
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                with company_operation(self.owner, self.company.pk, "register_opening_apply"), atomic():
                    RegisterOpening.objects.filter(pk=self.proposal.pk).update(
                        status="applied",
                        applied_entry=entry,
                        reviewed_by=self.owner,
                        reviewed_at=approval.decided_at,
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "submitted")

    def test_an_application_must_record_exactly_the_boundary_opening(self):
        forge_decision(self.proposal, "approve", self.owner, self.administrator)
        boundary_day = date.fromisoformat(self.proposal.boundary["block"]["date"])
        exact = sorted(
            [
                {"member": self.proposal.mapping[0]["member"], "shares": "80"},
                {"member": self.proposal.mapping[1]["member"], "shares": "20"},
            ],
            key=lambda change: change["member"],
        )
        for changes, effective_on, admitted in (
            (exact, boundary_day, True),
            ([], boundary_day, False),
            ([{**exact[0], "shares": "100"}], boundary_day, False),
            (exact, boundary_day - timedelta(days=1), False),
        ):
            with self.subTest(changes=changes, effective_on=effective_on):
                with self.assertRaises(RuntimeError), use_operator(), atomic():
                    application = forge_decision(self.proposal, "apply", self.owner, self.administrator)
                    register = ShareRegister.objects.create(
                        token_id=self.proposal.token_id, company_id=self.proposal.company_id
                    )
                    for link in self.proposal.mapping:
                        member = create_member(company_id=self.company.pk, member_id=link["member"])
                        RegisterMemberWallet.objects.create(
                            company=self.company, member=member, address=link["address"]
                        )
                    entry = record_entry(
                        register_id=register.pk,
                        operation_id=self.proposal.pk,
                        kind="opening",
                        changes=changes,
                        effective_on=effective_on,
                        recorded_by=self.owner,
                    )
                    if admitted:
                        forge_outcome(self.proposal, self.owner, application, status="applied", applied_entry=entry)
                    else:
                        with self.assertRaisesMessage(DatabaseError, "initialise the register from its captured"):
                            with atomic():
                                forge_outcome(
                                    self.proposal, self.owner, application, status="applied", applied_entry=entry
                                )
                    raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "submitted")

    def test_a_temporary_table_cannot_stand_in_for_the_decision_table(self):
        operator = connection.ops.quote_name(settings.RLS_ROLES["operator"])
        decided_at = timezone.now()
        with use_migrate(), self.assertRaises(RuntimeError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(f"SET LOCAL ROLE {operator}")
                cursor.execute(
                    "CREATE TEMP TABLE tokens_registeropeningdecision "
                    "(LIKE public.tokens_registeropeningdecision) ON COMMIT DROP"
                )
                cursor.execute(
                    "INSERT INTO pg_temp.tokens_registeropeningdecision (uuid, created_at, updated_at, "
                    "register_opening_id, kind, decided_by_id, appointment_id, idempotency_key, digest, reason, "
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
                    "set_config('app.company_operation', 'register_opening_reject', true), "
                    "set_config('app.company_id', %s, true)",
                    [str(self.owner.pk), str(self.company.pk)],
                )
                with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), atomic():
                    cursor.execute(
                        "UPDATE public.tokens_registeropening SET status = 'rejected', "
                        "rejection_reason = 'Forged', reviewed_by_id = %s, reviewed_at = %s WHERE uuid = %s",
                        [self.owner.pk, decided_at, self.proposal.pk],
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "submitted")

    def test_the_owner_without_an_appointment_decides_nothing(self):
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        with self.assertRaises(NotFound):
            decide(self.owner, self.administrator, self.proposal, "approve")
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.proposal, "approve", self.owner, self.administrator),
        )


class ScopedRegisterOpeningAuthorityTest(RunsOnTheScopedConnection, RegisterOpeningAuthorityTest):
    pass


class ScopedRegisterOpeningDecisionGuardTest(RunsOnTheScopedConnection, RegisterOpeningDecisionGuardTest):
    pass
