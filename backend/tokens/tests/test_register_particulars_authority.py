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
from companies.tests.test_document_file_access import DOCUMENT_BYTES
from operators.models import Operator
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.storage import private_storage
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterMemberParticulars,
    RegisterParticularsChange,
    RegisterParticularsChangeDecision,
)
from tokens.services.former_holders import purge_member_particulars, retention_cutoff
from tokens.services.register_events import create_member
from tokens.services.register_evidence import evidence_snapshot
from tokens.services.register_particulars import (
    decide_particulars_change,
    prepare_particulars_change,
)
from tokens.tests.evidence_fixtures import staff_user, upload_evidence
from tokens.tests.register_command_fixtures import legacy_entry_before_company_transfers
from tokens.tests.test_register_access import person
from tokens.tests.test_register_events import DAY
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import RESIDENCE
from tokens.tests.test_register_imports import decide as decide_import
from tokens.tests.test_register_imports import forge_decision as forge_import_decision
from tokens.tests.test_register_imports import import_payload
from tokens.tests.test_register_imports import prepared as prepared_import
from tokens.tests.test_register_imports import record_particulars
from tokens.tests.test_register_particulars import (
    NEW_ADDRESS,
    RENAMED,
    apply_change,
    change_payload,
    decide,
    decision_digest,
    forge_decision,
    forge_outcome,
    forged_fields,
    insert_forged,
    moved,
    particulars_fixture,
    prepared,
    preview,
    write_particulars,
)
from users.models import UserProfile

EVIDENCE = "/api/v1/tokens/register-evidence/"
PARTICULARS_CHANGES = "/api/v1/tokens/register-particulars-changes/"
IMPORTED = "come only from the company's application of that import"
MOVED = "stay with their member and never move to an earlier date"


def without_a_command(cursor):
    cursor.execute(f"SET LOCAL ROLE {connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
    cursor.execute(
        "SELECT set_config('app.user_id', '', true), set_config('app.company_operation', '', true), "
        "set_config('app.company_id', '', true)"
    )


class ParticularsAuthorityFixture(AppointsTeam):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, self.administrator, self.evidence = particulars_fixture()

    def prepare_as(self, actor, appointment, **changes):
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.SUPPORTING)
        return prepared(actor, change_payload(self.member, evidence, appointment, **changes))

    def prepared_by_the_owner(self, **changes):
        return prepared(self.owner, change_payload(self.member, self.evidence, self.administrator, **changes))

    def an_import(self, as_at=DAY, **changes):
        return prepared_import(
            self.owner,
            import_payload(
                self.token,
                upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SHARE_REGISTER),
                upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.ASIC_EXTRACT),
                self.member,
                self.administrator,
                as_at=as_at.isoformat(),
                **changes,
            ),
        )

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


class RegisterParticularsAuthorityTest(ParticularsAuthorityFixture, StubUploadDependencies, APITransactionTestCase):
    def test_each_step_takes_its_own_capability_or_administration_and_one_person_may_take_every_step(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        change = self.prepare_as(preparer, preparing)
        self.assertEqual((change.submitted_by_id, change.preparing_appointment_id), (preparer.pk, preparing.pk))
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
                    preview(actor, appointment, change, kind, reason)["unmet_requirements"],
                )
                with self.assertRaisesMessage(ValidationError, "appointment_capability_required"):
                    decide(actor, appointment, change, kind, reason)
        decide(approver, approving, change, "approve")
        applied = decide(applier, applying, change, "apply")
        with use_operator():
            decisions = [
                (row.kind, row.decided_by_id, row.appointment_id) for row in applied.decisions.order_by("decided_at")
            ]
            held = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual(decisions, [("approve", approver.pk, approving.pk), ("apply", applier.pk, applying.pk)])
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", applier.pk))
        self.assertEqual((held.name, held.source_change_id), (RENAMED, change.pk))
        rejected = decide(approver, approving, self.prepare_as(preparer, preparing), "reject", "Not this one")
        self.assertEqual((rejected.status, rejected.reviewed_by_id), ("rejected", approver.pk))

    def test_an_administrator_alone_prepares_approves_and_applies(self):
        change = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, change, "approve")
        self.assertEqual(decide(self.owner, self.administrator, change, "apply").status, "applied")

    def test_appointments_without_preparation_and_platform_roles_prepare_nothing(self):
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        finance, financing = self.appoint([CompanyCapability.FINANCE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        staff = staff_user()
        for actor, appointment in ((reader, reading), (finance, financing), (approver, approving)):
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                upload_evidence(actor, appointment, RegisterEvidenceKind.SUPPORTING)
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                prepared(actor, change_payload(self.member, self.evidence, appointment))
        with self.assertRaises(NotFound):
            upload_evidence(staff, self.administrator, RegisterEvidenceKind.SUPPORTING)
        with self.assertRaisesMessage(NotFound, "Register member not found"):
            prepared(staff, change_payload(self.member, self.evidence, self.administrator))
        with use_operator():
            self.assertFalse(RegisterParticularsChange.objects.exists())

    def test_only_the_preparers_own_supporting_upload_for_this_company_can_be_used(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        refusal = "supporting document you uploaded for this company"
        with self.assertRaisesMessage(ValidationError, refusal):
            prepared(preparer, change_payload(self.member, self.evidence, preparing))
        authority = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY)
        with self.assertRaisesMessage(ValidationError, refusal):
            self.prepared_by_the_owner(supporting_evidence=authority.pk)
        with use_operator():
            stranger, _, _, foreign_member, foreign_administrator, foreign_evidence = particulars_fixture()
        with self.assertRaisesMessage(ValidationError, refusal):
            self.prepared_by_the_owner(supporting_evidence=foreign_evidence.pk)
        for actor, payload in (
            (stranger, change_payload(self.member, foreign_evidence, foreign_administrator)),
            (self.owner, change_payload(foreign_member, self.evidence, self.administrator)),
        ):
            with self.subTest(actor=actor.email), self.assertRaisesMessage(NotFound, "Register member not found"):
                prepared(actor, payload)
        change = self.prepared_by_the_owner()
        with self.assertRaisesMessage(NotFound, "Register change not found"):
            preview(stranger, foreign_administrator, change, "approve")
        with use_operator():
            self.assertEqual(list(RegisterParticularsChange.objects.values_list("pk", flat=True)), [change.pk])

    def test_revocation_after_a_preview_refuses_the_decision_and_records_nothing(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        change = self.prepared_by_the_owner()
        digest = preview(approver, approving, change, "approve")["preview_digest"]
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        with self.assertRaises(NotFound):
            decide_particulars_change(
                actor=approver,
                change_id=change.pk,
                appointment=approving.pk,
                kind="approve",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with use_operator():
            self.assertFalse(RegisterParticularsChangeDecision.objects.exists())

    def test_a_preview_binds_its_change_appointment_and_reason(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        change = self.prepared_by_the_owner()
        other = self.prepared_by_the_owner(name="Mia Other")

        def decided(target, appointment, kind, digest, reason=""):
            return decide_particulars_change(
                actor=approver,
                change_id=target.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
                reason=reason,
            )

        approval = preview(approver, approving, change, "approve")["preview_digest"]
        rejection = preview(approver, approving, change, "reject", "The deed was withdrawn")["preview_digest"]
        with self.subTest(bound="change"), self.assertRaises(RegisterChangeConflict):
            decided(other, approving, "approve", approval)
        with self.subTest(bound="kind"), self.assertRaises(RegisterChangeConflict):
            decided(change, approving, "reject", approval)
        with self.subTest(bound="reason"), self.assertRaises(RegisterChangeConflict):
            decided(change, approving, "reject", rejection, "Another reason")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        reappointed = self.reappoint(approver, [CompanyCapability.APPROVE])
        with self.subTest(bound="appointment"), self.assertRaises(RegisterChangeConflict):
            decided(change, reappointed, "approve", approval)
        with use_operator():
            self.assertFalse(RegisterParticularsChangeDecision.objects.exists())
        self.assertEqual(
            decided(
                change, reappointed, "approve", preview(approver, reappointed, change, "approve")["preview_digest"]
            ).status,
            "submitted",
        )

    def test_an_expired_appointment_neither_prepares_nor_decides(self):
        expires_at = timezone.now() + timedelta(days=1)
        preparer, preparing = self.appoint(
            [CompanyCapability.PREPARE, CompanyCapability.APPROVE], expires_at=expires_at
        )
        change = self.prepare_as(preparer, preparing)
        later = expires_at + timedelta(seconds=1)
        with patch("tokens.services.register_authority.timezone.now", return_value=later):
            with self.assertRaises(NotFound):
                prepared(
                    preparer,
                    change_payload(self.member, change.supporting_evidence, preparing),
                )
            with self.assertRaises(NotFound):
                decide(preparer, preparing, change, "approve")

    def test_an_approval_whose_approver_lost_the_appointment_must_be_given_again(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        change = self.prepared_by_the_owner()
        client = APIClient()
        client.force_authenticate(self.owner)

        def stage():
            return client.get(f"{PARTICULARS_CHANGES}{change.pk}/").json()["stage"]

        decide(approver, approving, change, "approve")
        self.assertEqual(preview(self.owner, self.administrator, change, "apply")["unmet_requirements"], [])
        self.assertEqual(stage(), "approved")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        self.assertEqual(
            preview(self.owner, self.administrator, change, "apply")["unmet_requirements"], ["approval_lapsed"]
        )
        self.assertEqual(stage(), "submitted")
        with self.assertRaisesMessage(ValidationError, "approval_lapsed"):
            decide(self.owner, self.administrator, change, "apply")
        with self.assertRaisesMessage(ValidationError, "approval_required"):
            decide(self.owner, self.administrator, self.prepared_by_the_owner(), "apply")
        decide(self.owner, self.administrator, change, "approve")
        self.assertEqual(decide(self.owner, self.administrator, change, "apply").status, "applied")
        self.assertEqual(stage(), "applied")

    def test_the_issuer_identity_requirement_applies_to_every_register_command(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with use_migrate():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            upload_evidence(preparer, preparing, RegisterEvidenceKind.SUPPORTING)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            prepared(preparer, change_payload(self.member, self.evidence, preparing))
        with use_migrate():
            UserProfile.objects.filter(user=preparer).update(is_id_verified=True)
        change = self.prepare_as(preparer, preparing)
        self.assertEqual(change.submitted_by_id, preparer.pk)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            decide(self.owner, self.administrator, change, "approve")

    def test_evidence_whose_bytes_changed_is_refused_before_and_after_preparation(self):
        tampered = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SUPPORTING)
        with private_storage().open(tampered.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        with self.assertRaisesMessage(ValidationError, "no longer matches its record"):
            self.prepared_by_the_owner(supporting_evidence=tampered.pk)
        change = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, change, "approve")
        with private_storage().open(change.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        self.assertEqual(
            preview(self.owner, self.administrator, change, "apply")["unmet_requirements"], ["evidence_unavailable"]
        )
        with self.assertRaisesMessage(ValidationError, "evidence_unavailable"):
            decide(self.owner, self.administrator, change, "apply")
        rejected = decide(self.owner, self.administrator, change, "reject", "The retained copy changed")
        self.assertEqual(rejected.status, "rejected")

    def test_an_identical_preparation_retry_returns_it_and_a_changed_one_conflicts(self):
        payload = change_payload(self.member, self.evidence, self.administrator)
        first, created = prepare_particulars_change(actor=self.owner, **payload)
        again, repeated = prepare_particulars_change(actor=self.owner, **{**payload, "name": f" {RENAMED} "})
        self.assertEqual((first.pk, created, again.pk, repeated), (first.pk, True, first.pk, False))
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with use_operator():
            other_member = particulars_fixture()[3]
        for actor, changes in (
            (self.owner, {"reason": "Changed"}),
            (self.owner, {"name": "Mia Changed"}),
            (self.owner, {"residential_address": "1 Other Street"}),
            (self.owner, {"as_at": DAY - timedelta(days=1)}),
            (
                self.owner,
                {
                    "supporting_evidence": upload_evidence(
                        self.owner, self.administrator, RegisterEvidenceKind.SUPPORTING
                    ).pk
                },
            ),
            (preparer, {"appointment": preparing.pk}),
        ):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                prepare_particulars_change(actor=actor, **{**payload, **changes})
        with self.assertRaisesMessage(NotFound, "Register member not found"):
            prepare_particulars_change(actor=self.owner, **{**payload, "member": other_member.pk})
        with use_operator():
            self.assertEqual(RegisterParticularsChange.objects.count(), 1)
        own = change_payload(
            self.member, upload_evidence(preparer, preparing, RegisterEvidenceKind.SUPPORTING), preparing
        )
        prepare_particulars_change(actor=preparer, **own)
        revoke_company_appointment(requester=self.owner, appointment_id=preparing.pk)
        reappointed = self.reappoint(preparer, [CompanyCapability.PREPARE])
        with self.assertRaises(RegisterChangeConflict):
            prepare_particulars_change(actor=preparer, **{**own, "appointment": reappointed.pk})
        with use_operator():
            self.assertEqual(RegisterParticularsChange.objects.count(), 2)

    def test_the_api_uploads_prepares_previews_and_decides(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        body = {
            "company_id": str(self.company.pk),
            "appointment": str(self.administrator.pk),
            "kind": RegisterEvidenceKind.SUPPORTING,
            "idempotency_key": str(uuid4()),
        }
        uploaded = client.post(
            EVIDENCE,
            {**body, "file": SimpleUploadedFile("deed-poll.pdf", DOCUMENT_BYTES, content_type="application/pdf")},
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        receipt = uploaded.json()
        self.assertEqual(
            (receipt["kind"], receipt["providedBy"], receipt["fileSize"]),
            ("supporting", "company", len(DOCUMENT_BYTES)),
        )
        changed = client.post(
            EVIDENCE,
            {**body, "file": SimpleUploadedFile("deed-poll.pdf", pdf_bytes(pages=2), content_type="application/pdf")},
            format="multipart",
        )
        self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator():
            evidence = RegisterEvidence.objects.get(pk=receipt["uuid"])
        payload = {**change_payload(self.member, evidence, self.administrator), "as_at": DAY.isoformat()}
        created = client.post(PARTICULARS_CHANGES, payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(client.post(PARTICULARS_CHANGES, payload, format="json").status_code, 200)
        change = created.json()
        self.assertEqual(
            (change["stage"], change["providedBy"], change["supportingEvidence"], change["decisions"]),
            ("submitted", "company", receipt["uuid"], []),
        )
        self.assertEqual(change["evidenceSnapshot"]["name"], "deed-poll.pdf")
        detail = f"{PARTICULARS_CHANGES}{change['uuid']}/"
        file = client.get(f"{detail}file/")
        self.assertEqual((file.status_code, b"".join(file.streaming_content)), (200, DOCUMENT_BYTES))
        for kind in ("approve", "apply"):
            decision = {"appointment": str(self.administrator.pk), "kind": kind}
            previewed = client.post(f"{detail}decision-preview/", decision, format="json")
            self.assertEqual(previewed.status_code, 200, previewed.content)
            self.assertEqual(
                {key: value for key, value in previewed.json().items() if key != "previewDigest"},
                {
                    "unmetRequirements": [],
                    "canDecide": True,
                    "member": str(self.member.pk),
                    "name": RENAMED,
                    "residentialAddress": NEW_ADDRESS,
                    "asAt": DAY.isoformat(),
                    "current": None,
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
        later = client.post(
            PARTICULARS_CHANGES,
            {
                **payload,
                "operation_id": str(uuid4()),
                "name": "Mia Later",
                "as_at": (DAY + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(later.status_code, 201, later.content)
        compared = client.post(
            f"{PARTICULARS_CHANGES}{later.json()['uuid']}/decision-preview/",
            {"appointment": str(self.administrator.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(
            compared.json()["current"],
            {
                "name": RENAMED,
                "residentialAddress": NEW_ADDRESS,
                "asAt": DAY.isoformat(),
                "sourceImport": None,
                "sourceChange": change["uuid"],
                "sourceGrant": None,
                "sourceTransfer": None,
            },
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
        listed = client.get(PARTICULARS_CHANGES, {"member": str(self.member.pk), "status": "applied"}).json()
        self.assertEqual([row["uuid"] for row in listed["results"]], [change["uuid"]])


class RegisterParticularsDecisionGuardTest(ParticularsAuthorityFixture, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.change = self.prepared_by_the_owner()

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
                original_filename="deed-poll.pdf",
                file_size=10,
                mime_type="application/pdf",
                sha256="a" * 64,
            )

    def test_the_database_admits_supporting_uploads_and_no_other_new_kind(self):
        with self.assertRaises(RuntimeError), atomic():
            self.evidence_row(RegisterEvidenceKind.SUPPORTING)
            raise RuntimeError("rollback")
        self.assert_refused("current preparation authority", lambda: self.evidence_row("constitution"))

    def test_the_database_admits_only_exact_current_company_decisions(self):
        stranger = person(f"stranger-{uuid4()}@example.test")
        refused = "exact current company authority"
        self.assert_refused(refused, lambda: forge_decision(self.change, "apply", self.owner, self.administrator))
        self.assert_refused(
            refused,
            lambda: forge_decision(self.change, "approve", self.owner, self.administrator, digest="0" * 64),
        )
        self.assert_refused(refused, lambda: forge_decision(self.change, "reject", self.owner, self.administrator))
        self.assert_refused(
            refused,
            lambda: forge_decision(self.change, "reject", self.owner, self.administrator, reason=" \t"),
        )
        self.assert_refused(
            refused, lambda: forge_decision(self.change, "approve", self.owner, self.administrator, reason="No")
        )
        self.assert_refused(refused, lambda: forge_decision(self.change, "approve", stranger, self.administrator))
        for operation, scope in (
            ("register_particulars_apply", self.company.pk),
            ("register_correction_approve", self.company.pk),
            ("register_particulars_approve", uuid4()),
        ):
            with self.subTest(operation=operation), company_operation(self.owner, scope, operation):
                with self.assertRaisesMessage(DatabaseError, refused), atomic():
                    RegisterParticularsChangeDecision.objects.create(
                        register_particulars_change=self.change,
                        kind="approve",
                        decided_by=self.owner,
                        appointment=self.administrator,
                        idempotency_key=uuid4(),
                        digest=decision_digest(self.change, "approve", self.owner, self.administrator),
                        decided_at=timezone.now(),
                    )
        approval = forge_decision(self.change, "approve", self.owner, self.administrator)
        self.assert_refused(refused, lambda: forge_decision(self.change, "approve", self.owner, self.administrator))
        with company_operation(self.owner, self.company.pk, "register_particulars_approve"):
            for write in (
                lambda: RegisterParticularsChangeDecision.objects.filter(pk=approval.pk).update(reason="Rewritten"),
                lambda: RegisterParticularsChangeDecision.objects.filter(pk=approval.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "append-only"), atomic():
                    write()

    def test_the_database_admits_a_decision_only_by_its_principal_of_a_known_kind_on_an_undecided_change(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        refused = "exact current company authority"
        self.assert_refused(
            refused,
            lambda: forge_decision(self.change, "approve", self.owner, self.administrator, decided_by=approver),
        )
        self.assert_refused(refused, lambda: forge_decision(self.change, "other", self.owner, self.administrator))
        decide(approver, approving, self.change, "reject", "Prepare it again")
        self.assert_refused(refused, lambda: forge_decision(self.change, "approve", self.owner, self.administrator))

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
                    refused, lambda: forge_decision(self.change, kind, actor, appointment, reason=reason)
                )
        forge_decision(self.change, "approve", approver, approving)
        self.assert_refused(refused, lambda: forge_decision(self.change, "apply", approver, approving))
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_decision(self.change, "reject", approver, approving, reason="Mine to reject")
            raise RuntimeError("rollback")

    def test_the_database_admits_a_change_only_from_its_preparers_own_supporting_upload(self):
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
        forged = forged_fields(self.change)
        refused = "exact current intent"
        self.assert_refused(refused, lambda: insert_forged(forged, self.owner, scope=uuid4()))
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        self.assert_refused(refused, lambda: insert_forged(forged, self.owner, preparing_appointment=reading))
        with use_operator():
            stranger, other_company, _, _, other_administrator, _ = particulars_fixture()
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
        foreign = upload_evidence(self.owner, elsewhere, RegisterEvidenceKind.SUPPORTING)
        with self.assertRaisesMessage(ValidationError, "supporting document you uploaded for this company"):
            self.prepared_by_the_owner(supporting_evidence=foreign.pk)
        self.assert_refused(
            refused,
            lambda: insert_forged(
                forged,
                self.owner,
                supporting_evidence=foreign,
                evidence_fingerprint=foreign.sha256,
                evidence_snapshot=evidence_snapshot(foreign),
            ),
        )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner)
            raise RuntimeError("rollback")

    def test_the_database_refuses_an_application_whose_particulars_changed_after_its_preview(self):
        forge_decision(self.change, "approve", self.owner, self.administrator)
        with use_operator():
            stale = decision_digest(self.change, "apply", self.owner, self.administrator)
        other = self.prepared_by_the_owner(name="Mia Meanwhile")
        decide(self.owner, self.administrator, other, "approve")
        decide(self.owner, self.administrator, other, "apply")
        with use_operator():
            self.assertNotEqual(decision_digest(self.change, "apply", self.owner, self.administrator), stale)
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.change, "apply", self.owner, self.administrator, digest=stale),
        )

    def test_an_outcome_needs_its_own_decision_and_a_decision_needs_its_own_outcome(self):
        forge_decision(self.change, "approve", self.owner, self.administrator)
        with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), atomic():
            with company_operation(self.owner, self.company.pk, "register_particulars_reject"), atomic():
                RegisterParticularsChange.objects.filter(pk=self.change.pk).update(
                    status="rejected", rejection_reason="Forged", reviewed_by=self.owner, reviewed_at=timezone.now()
                )
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(self.change, "reject", self.owner, self.administrator, reason="Without effect")
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(self.change, "apply", self.owner, self.administrator)
            write_particulars(self.change, self.owner)
        other = self.prepared_by_the_owner(name="Mia Other")
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(other, "approve", self.owner, self.administrator)
            decision = forge_decision(other, "reject", self.owner, self.administrator, reason="At once")
            forge_outcome(other, self.owner, decision, status="rejected", rejection_reason="At once")
        with self.assertRaisesMessage(DatabaseError, "Only the exact company decision"), use_operator(), atomic():
            decision = forge_decision(self.change, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.change, self.owner, decision, status="rejected", rejection_reason="Different")
        with use_operator(), atomic():
            decision = forge_decision(self.change, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.change, self.owner, decision, status="rejected", rejection_reason="Exact")
        with use_operator():
            self.change.refresh_from_db()
            self.assertFalse(RegisterMemberParticulars.objects.exists())
        self.assertEqual((self.change.status, self.change.rejection_reason), ("rejected", "Exact"))

    def test_an_application_must_record_the_changes_particulars_for_its_member(self):
        identical = {
            "member": str(self.member.pk),
            "name": RENAMED,
            "residential_address": NEW_ADDRESS,
            "shares": "100",
            "entered_on": "2019-05-01",
            "amount_paid": None,
        }
        imported = self.an_import(members=[identical])
        for kind in ("approve", "apply"):
            decide_import(self.owner, self.administrator, imported, kind)
        forge_decision(self.change, "approve", self.owner, self.administrator)
        refused = "Application must record the change's particulars"
        with self.assertRaisesMessage(DatabaseError, refused), use_operator(), atomic():
            decision = forge_decision(self.change, "apply", self.owner, self.administrator)
            forge_outcome(self.change, self.owner, decision, status="applied")
        with self.assertRaisesMessage(DatabaseError, refused), use_operator(), atomic():
            decision = forge_decision(self.change, "apply", self.owner, self.administrator)
            write_particulars(self.change, self.owner)
            forge_outcome(self.change, self.owner, decision, status="applied", rejection_reason="Forged")
        with use_operator(), atomic():
            decision = forge_decision(self.change, "apply", self.owner, self.administrator)
            write_particulars(self.change, self.owner)
            forge_outcome(self.change, self.owner, decision, status="applied")
        with use_operator():
            self.change.refresh_from_db()
            held = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((self.change.status, held.source_change_id, held.name), ("applied", self.change.pk, RENAMED))

    def test_an_outcome_is_written_only_by_its_decider_at_its_decision_time_for_its_kind(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        refused = "Only the exact company decision"

        def outcome(actor, **fields):
            with company_operation(actor, self.company.pk, "register_particulars_reject"), atomic():
                RegisterParticularsChange.objects.filter(pk=self.change.pk).update(**fields)

        with self.assertRaises(RuntimeError), use_operator(), atomic():
            decision = forge_decision(self.change, "reject", approver, approving, reason="Exact")
            rejected = {"status": "rejected", "rejection_reason": "Exact"}
            for actor, fields in (
                (approver, {"rejection_reason": "Exact", "reviewed_by": approver, "reviewed_at": decision.decided_at}),
                (self.owner, {**rejected, "reviewed_by": approver, "reviewed_at": decision.decided_at}),
                (self.owner, {**rejected, "reviewed_by": self.owner, "reviewed_at": decision.decided_at}),
                (approver, {**rejected, "reviewed_by": approver, "reviewed_at": timezone.now()}),
                (approver, {"status": "applied", "reviewed_by": approver, "reviewed_at": decision.decided_at}),
            ):
                with self.subTest(actor=actor.email, fields=fields):
                    with self.assertRaisesMessage(DatabaseError, refused), atomic():
                        outcome(actor, **fields)
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterParticularsChange.objects.get(pk=self.change.pk).status, "submitted")

    def test_particulars_from_a_change_come_only_from_its_application(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE, CompanyCapability.APPLY])
        with use_operator():
            other_member = particulars_fixture()[3]
        refused = "come only from the company's application of that change"
        self.assert_refused(refused, lambda: write_particulars(self.change, self.owner))
        forge_decision(self.change, "approve", self.owner, self.administrator)
        self.assert_refused(refused, lambda: write_particulars(self.change, self.owner))
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_decision(self.change, "apply", self.owner, self.administrator)
            for actor, operation, fields in (
                (self.owner, "register_particulars_approve", {}),
                (self.owner, "register_import_apply", {}),
                (approver, "register_particulars_apply", {}),
                (self.owner, "register_particulars_apply", {"name": "Mia Forged"}),
                (self.owner, "register_particulars_apply", {"residential_address": "1 Forged Street"}),
                (self.owner, "register_particulars_apply", {"as_at": DAY - timedelta(days=1)}),
            ):
                with self.subTest(actor=actor.email, operation=operation, fields=fields):
                    with self.assertRaisesMessage(DatabaseError, refused), atomic():
                        write_particulars(self.change, actor, operation, **fields)
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                with company_operation(self.owner, uuid4(), "register_particulars_apply"), atomic():
                    RegisterMemberParticulars.objects.create(
                        member=self.member,
                        name=self.change.name,
                        residential_address=self.change.residential_address,
                        as_at=self.change.as_at,
                        source_change=self.change,
                    )
            with self.assertRaisesMessage(DatabaseError, refused), atomic():
                with company_operation(self.owner, self.company.pk, "register_particulars_apply"), atomic():
                    RegisterMemberParticulars.objects.create(
                        member=other_member,
                        name=self.change.name,
                        residential_address=self.change.residential_address,
                        as_at=self.change.as_at,
                        source_change=self.change,
                    )
            write_particulars(self.change, self.owner)
            self.assertEqual(RegisterMemberParticulars.objects.get(member=self.member).source_change_id, self.change.pk)
            raise RuntimeError("rollback")

    def test_particulars_from_a_change_never_replace_later_particulars_or_change_after_it_applied(self):
        refused = "come only from the company's application of that change"
        later = self.prepared_by_the_owner(name="Mia Later", as_at=DAY + timedelta(days=1))
        decide(self.owner, self.administrator, later, "approve")
        decide(self.owner, self.administrator, later, "apply")
        forge_decision(self.change, "approve", self.owner, self.administrator)
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_decision(self.change, "apply", self.owner, self.administrator)
            with self.assertRaisesMessage(DatabaseError, MOVED), atomic():
                write_particulars(self.change, self.owner)
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterMemberParticulars.objects.get(member=self.member).source_change_id, later.pk)
        self.assert_refused(refused, lambda: write_particulars(later, self.owner, name="Mia Rewritten"))
        self.assert_refused(refused, lambda: write_particulars(later, self.owner))

    def test_imported_particulars_come_only_from_their_imports_application(self):
        applier, _ = self.appoint([CompanyCapability.APPROVE, CompanyCapability.APPLY])
        with use_operator():
            neighbour = create_member(company_id=self.company.pk, member_id=uuid4())
        proposal = self.an_import()
        self.assert_refused(IMPORTED, lambda: record_particulars(proposal, self.owner))
        decide_import(self.owner, self.administrator, proposal, "approve")
        self.assert_refused(IMPORTED, lambda: record_particulars(proposal, self.owner))
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_import_decision(proposal, "apply", self.owner, self.administrator)
            for actor, operation, scope, fields in (
                (self.owner, "register_import_approve", None, {}),
                (self.owner, "register_particulars_apply", None, {}),
                (applier, "register_import_apply", None, {}),
                (self.owner, "register_import_apply", uuid4(), {}),
                (self.owner, "register_import_apply", None, {"name": "Mia Forged"}),
                (self.owner, "register_import_apply", None, {"residential_address": "1 Forged Street"}),
                (self.owner, "register_import_apply", None, {"as_at": DAY - timedelta(days=1)}),
                (self.owner, "register_import_apply", None, {"as_at": DAY + timedelta(days=1)}),
            ):
                with self.subTest(actor=actor.email, operation=operation, scope=scope, fields=fields):
                    with self.assertRaisesMessage(DatabaseError, IMPORTED), atomic():
                        record_particulars(proposal, actor, operation, scope, **fields)
            with self.assertRaisesMessage(DatabaseError, IMPORTED), atomic():
                with company_operation(self.owner, self.company.pk, "register_import_apply"), atomic():
                    RegisterMemberParticulars.objects.create(
                        member=neighbour,
                        name="Mia Member",
                        residential_address=RESIDENCE,
                        as_at=DAY,
                        source_import=proposal,
                    )
            record_particulars(proposal, self.owner)
            held = RegisterMemberParticulars.objects.get(member=self.member)
            self.assertEqual((held.name, held.as_at, held.source_import_id), ("Mia Member", DAY, proposal.pk))
            raise RuntimeError("rollback")
        self.assertEqual(decide_import(self.owner, self.administrator, proposal, "apply").status, "applied")
        self.assert_refused(IMPORTED, lambda: record_particulars(proposal, self.owner))
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((held.name, held.source_import_id), ("Mia Member", proposal.pk))

    def test_the_operator_without_a_command_neither_resources_nor_inserts_imported_particulars(self):
        decide(self.owner, self.administrator, self.change, "approve")
        decide(self.owner, self.administrator, self.change, "apply")
        older, same_day = self.an_import(DAY - timedelta(days=10)), self.an_import()
        with use_operator():
            stranger = particulars_fixture()[3]
        for refusal, forgery, values in (
            (
                MOVED,
                "UPDATE tokens_registermemberparticulars SET source_change_id = NULL, source_import_id = %s, "
                "as_at = %s, name = 'Forged Name', residential_address = 'Forged Address' WHERE member_id = %s",
                [older.pk, older.as_at, self.member.pk],
            ),
            (
                IMPORTED,
                "UPDATE tokens_registermemberparticulars SET source_change_id = NULL, source_import_id = %s, "
                "name = 'Mia Member', residential_address = %s WHERE member_id = %s",
                [same_day.pk, RESIDENCE, self.member.pk],
            ),
            (
                IMPORTED,
                "INSERT INTO tokens_registermemberparticulars (uuid, created_at, updated_at, member_id, name, "
                "residential_address, as_at, source_import_id) VALUES (%s, now(), now(), %s, 'Forged', "
                "'Forged Street', %s, %s)",
                [uuid4(), stranger.pk, same_day.as_at, same_day.pk],
            ),
        ):
            with self.subTest(forgery=forgery), use_migrate(), self.assertRaisesMessage(DatabaseError, refusal):
                with atomic(), connections[current_alias()].cursor() as cursor:
                    without_a_command(cursor)
                    cursor.execute(forgery, values)
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=self.member)
            self.assertFalse(RegisterMemberParticulars.objects.filter(member=stranger).exists())
        self.assertEqual((held.name, held.source_change_id, held.source_import_id), (RENAMED, self.change.pk, None))

    def test_imported_particulars_never_replace_later_particulars(self):
        decide(self.owner, self.administrator, self.change, "approve")
        decide(self.owner, self.administrator, self.change, "apply")
        older = self.an_import(DAY - timedelta(days=3))
        decide_import(self.owner, self.administrator, older, "approve")
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_import_decision(older, "apply", self.owner, self.administrator)
            with self.assertRaisesMessage(DatabaseError, MOVED), atomic():
                record_particulars(older, self.owner)
            raise RuntimeError("rollback")
        self.assertEqual(decide_import(self.owner, self.administrator, older, "apply").status, "applied")
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((held.name, held.as_at, held.source_change_id), (RENAMED, DAY, self.change.pk))

    def test_particulars_never_move_to_another_member(self):
        with use_operator():
            other = create_member(company_id=self.company.pk, member_id=uuid4())
            moved(self.token.stored_register.pk, self.member, other, 50, self.owner)
        theirs = apply_change(
            self.owner,
            self.administrator,
            prepared(self.owner, change_payload(other, self.evidence, self.administrator, name="Olive Other")),
        )
        forge_decision(self.change, "approve", self.owner, self.administrator)
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_decision(self.change, "apply", self.owner, self.administrator)
            with self.assertRaisesMessage(DatabaseError, MOVED), atomic():
                with company_operation(self.owner, self.company.pk, "register_particulars_apply"), atomic():
                    RegisterMemberParticulars.objects.filter(member=other).update(
                        member=self.member,
                        name=self.change.name,
                        residential_address=self.change.residential_address,
                        as_at=self.change.as_at,
                        source_change=self.change,
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterMemberParticulars.objects.get(member=other).source_change_id, theirs.pk)
            self.assertFalse(RegisterMemberParticulars.objects.filter(member=self.member).exists())

    def test_a_company_command_never_removes_particulars_and_only_the_purge_may(self):
        refused = "Only the retention purge removes member particulars"
        decide(self.owner, self.administrator, self.change, "approve")
        later = self.prepared_by_the_owner(name="Mia Later", as_at=DAY + timedelta(days=1))
        apply_change(self.owner, self.administrator, later)
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            forge_decision(self.change, "apply", self.owner, self.administrator)
            for operation in ("register_particulars_apply", "register_import_apply"):
                with self.subTest(operation=operation), self.assertRaisesMessage(DatabaseError, refused), atomic():
                    with company_operation(self.owner, self.company.pk, operation), atomic():
                        RegisterMemberParticulars.objects.filter(member=self.member).delete()
            raise RuntimeError("rollback")
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((held.name, held.source_change_id), ("Mia Later", later.pk))
        with use_migrate(), self.assertRaisesMessage(
            DatabaseError, "actual exit clock and continued membership"
        ), atomic():
            with connections[current_alias()].cursor() as cursor:
                without_a_command(cursor)
                cursor.execute("DELETE FROM tokens_registermemberparticulars WHERE member_id = %s", [self.member.pk])
        with use_operator():
            self.assertEqual(purge_member_particulars(), 0)
        legacy_entry_before_company_transfers(
            self.token,
            self.owner,
            "cessation",
            [{"member": str(self.member.pk), "shares": "-100"}],
            retention_cutoff() - timedelta(days=1),
        )
        with use_migrate(), self.assertRaises(RuntimeError), atomic():
            with connections[current_alias()].cursor() as cursor:
                without_a_command(cursor)
                cursor.execute("DELETE FROM tokens_registermemberparticulars WHERE member_id = %s", [self.member.pk])
                self.assertEqual(cursor.rowcount, 1)
            raise RuntimeError("rollback")
        with use_operator():
            self.assertTrue(RegisterMemberParticulars.objects.filter(member=self.member).exists())
            self.assertEqual(purge_member_particulars(), 1)
            self.assertFalse(RegisterMemberParticulars.objects.filter(member=self.member).exists())
            later.refresh_from_db()
            self.assertEqual((later.status, later.name), ("applied", "Mia Later"))
            self.assertTrue(later.file.storage.exists(later.file.name))
            self.assertTrue(later.supporting_evidence.file.storage.exists(later.supporting_evidence.file.name))

    def test_a_temporary_table_cannot_stand_in_for_the_decision_table(self):
        operator = connection.ops.quote_name(settings.RLS_ROLES["operator"])
        decided_at = timezone.now()
        forge_decision(self.change, "approve", self.owner, self.administrator)
        for forgery, values, refusal in (
            (
                "UPDATE public.tokens_registerparticularschange SET status = 'rejected', "
                "rejection_reason = 'Forged', reviewed_by_id = %s, reviewed_at = %s WHERE uuid = %s",
                [self.owner.pk, decided_at, self.change.pk],
                "Only the exact company decision",
            ),
            (
                "INSERT INTO public.tokens_registermemberparticulars (uuid, created_at, updated_at, member_id, name, "
                "residential_address, as_at, source_change_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    uuid4(),
                    decided_at,
                    decided_at,
                    self.member.pk,
                    self.change.name,
                    self.change.residential_address,
                    self.change.as_at,
                    self.change.pk,
                ],
                "come only from the company's application of that change",
            ),
        ):
            with self.subTest(refusal=refusal), use_migrate(), self.assertRaises(RuntimeError), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f"SET LOCAL ROLE {operator}")
                    cursor.execute(
                        "CREATE TEMP TABLE tokens_registerparticularschangedecision "
                        "(LIKE public.tokens_registerparticularschangedecision) ON COMMIT DROP"
                    )
                    for kind, reason in (("reject", "Forged"), ("apply", "")):
                        cursor.execute(
                            "INSERT INTO pg_temp.tokens_registerparticularschangedecision (uuid, created_at, "
                            "updated_at, register_particulars_change_id, kind, decided_by_id, appointment_id, "
                            "idempotency_key, digest, reason, decided_at) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                            [
                                uuid4(),
                                decided_at,
                                decided_at,
                                self.change.pk,
                                kind,
                                self.owner.pk,
                                self.administrator.pk,
                                uuid4(),
                                "0" * 64,
                                reason,
                                decided_at,
                            ],
                        )
                    cursor.execute(
                        "SELECT set_config('app.user_id', %s, true), "
                        "set_config('app.company_operation', 'register_particulars_apply', true), "
                        "set_config('app.company_id', %s, true)",
                        [str(self.owner.pk), str(self.company.pk)],
                    )
                    with self.assertRaisesMessage(DatabaseError, refusal), atomic():
                        cursor.execute(forgery, values)
                raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterParticularsChange.objects.get(pk=self.change.pk).status, "submitted")
            self.assertFalse(RegisterMemberParticulars.objects.exists())

    def test_a_temporary_table_cannot_stand_in_for_an_imports_decision(self):
        proposal = self.an_import()
        decide_import(self.owner, self.administrator, proposal, "approve")
        with use_migrate(), self.assertRaises(RuntimeError), atomic():
            with connections[current_alias()].cursor() as cursor:
                without_a_command(cursor)
                cursor.execute(
                    "CREATE TEMP TABLE tokens_registerimportdecision "
                    "(LIKE public.tokens_registerimportdecision) ON COMMIT DROP"
                )
                cursor.execute(
                    "INSERT INTO pg_temp.tokens_registerimportdecision (uuid, created_at, updated_at, "
                    "register_import_id, kind, decided_by_id, appointment_id, idempotency_key, digest, reason, "
                    "decided_at) VALUES (%s, now(), now(), %s, 'apply', %s, %s, %s, %s, '', now())",
                    [uuid4(), proposal.pk, self.owner.pk, self.administrator.pk, uuid4(), "0" * 64],
                )
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, true), "
                    "set_config('app.company_operation', 'register_import_apply', true), "
                    "set_config('app.company_id', %s, true)",
                    [str(self.owner.pk), str(self.company.pk)],
                )
                with self.assertRaisesMessage(DatabaseError, IMPORTED), atomic():
                    cursor.execute(
                        "INSERT INTO public.tokens_registermemberparticulars (uuid, created_at, updated_at, "
                        "member_id, name, residential_address, as_at, source_import_id) "
                        "VALUES (%s, now(), now(), %s, 'Mia Member', %s, %s, %s)",
                        [uuid4(), self.member.pk, RESIDENCE, proposal.as_at, proposal.pk],
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertFalse(RegisterMemberParticulars.objects.exists())

    def test_the_owner_without_an_appointment_decides_nothing(self):
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        with self.assertRaises(NotFound):
            decide(self.owner, self.administrator, self.change, "approve")
        self.assert_refused(
            "exact current company authority",
            lambda: forge_decision(self.change, "approve", self.owner, self.administrator),
        )
