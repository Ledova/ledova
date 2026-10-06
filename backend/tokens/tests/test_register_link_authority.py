from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connection, connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import CompanyCapability
from companies.services.administration import company_operation
from companies.services.team import revoke_company_appointment
from companies.tests.test_document_file_access import DOCUMENT_BYTES
from shared.db import MIGRATE_ALIAS, atomic, current_alias, use_migrate, use_operator
from shared.storage import private_storage
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.models import (
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterMemberWallet,
    RegisterWalletLink,
    RegisterWalletLinkDecision,
    ShareToken,
)
from tokens.services import register_openings
from tokens.services.register_events import create_member
from tokens.services.register_evidence import evidence_snapshot
from tokens.services.register_openings import decide_link
from tokens.tests.evidence_fixtures import staff_user, upload_evidence
from tokens.tests.test_register_access import person
from tokens.tests.test_register_acknowledgement_authority import locked
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_links import (
    CAROL,
    DAVE,
    LINKS,
    WAITING,
    apply_link,
    decide,
    decision_digest,
    forge_decision,
    forge_outcome,
    forged_fields,
    holder,
    insert_forged,
    link_fixture,
    link_payload,
    prepared,
    preview,
    staff_era,
)

EVIDENCE = "/api/v1/tokens/register-evidence/"
COMMAND_REFUSED = "exact current company authority"
PREPARATION_REFUSED = "exact current intent, company authority and evidence"
OUTCOME_REFUSED = "Only the exact company decision"


class LinkAuthorityFixture(AppointsTeam):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.member, self.administrator, self.evidence = link_fixture()

    def payload(self, evidence, appointment, **changes):
        return link_payload(self.company, evidence, appointment, **changes)

    def prepare_as(self, actor, appointment, **changes):
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        return prepared(actor, self.payload(evidence, appointment, **changes))

    def prepared_by_the_owner(self, **changes):
        return prepared(self.owner, self.payload(self.evidence, self.administrator, **changes))


class RegisterWalletLinkAuthorityTest(LinkAuthorityFixture, StubUploadDependencies, APITransactionTestCase):
    def test_each_step_takes_its_own_capability_or_administration_and_one_person_may_take_every_step(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        link = self.prepare_as(preparer, preparing)
        self.assertEqual((link.submitted_by_id, link.preparing_appointment_id), (preparer.pk, preparing.pk))
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
                    preview(actor, appointment, link, kind, reason)["unmet_requirements"],
                )
                with self.assertRaisesMessage(ValidationError, "appointment_capability_required"):
                    decide(actor, appointment, link, kind, reason)
        decide(approver, approving, link, "approve")
        applied = decide(applier, applying, link, "apply")
        with use_operator():
            decisions = [
                (row.kind, row.decided_by_id, row.appointment_id) for row in applied.decisions.order_by("decided_at")
            ]
        self.assertEqual(decisions, [("approve", approver.pk, approving.pk), ("apply", applier.pk, applying.pk)])
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", applier.pk))
        another = self.prepare_as(preparer, preparing, mapping=[{"address": DAVE, "member": str(uuid4())}])
        rejected = decide(approver, approving, another, "reject", "Not this one")
        self.assertEqual((rejected.status, rejected.reviewed_by_id), ("rejected", approver.pk))
        alone = apply_link(
            self.owner,
            self.administrator,
            self.prepared_by_the_owner(mapping=[{"address": DAVE, "member": str(uuid4())}]),
        )
        self.assertEqual(alone.status, "applied")

    def test_appointments_without_preparation_platform_staff_and_the_owner_alone_prepare_nothing(self):
        link = self.prepared_by_the_owner()
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        for actor, appointment in ((reader, reading), (approver, approving)):
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
            with self.subTest(actor=actor.email), self.assertRaises(NotFound):
                prepared(actor, self.payload(self.evidence, appointment))
        staff = staff_user()
        with self.assertRaisesMessage(NotFound, "Company not found"):
            prepared(staff, self.payload(self.evidence, self.administrator))
        with self.assertRaisesMessage(NotFound, "Register link not found"):
            preview(staff, self.administrator, link, "approve")
        with use_operator():
            stranger, _, _, foreign_administrator, foreign_evidence = link_fixture()
        with self.assertRaisesMessage(NotFound, "Company not found"):
            prepared(stranger, self.payload(foreign_evidence, foreign_administrator))
        with self.assertRaisesMessage(NotFound, "Register link not found"):
            decide(stranger, foreign_administrator, link, "reject", "Not theirs to reject")
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        with self.assertRaisesMessage(NotFound, "Company not found"):
            prepared(self.owner, self.payload(self.evidence, self.administrator))
        with self.assertRaises(NotFound):
            decide(self.owner, self.administrator, link, "approve")
        with use_operator():
            self.assertEqual(list(RegisterWalletLink.objects.values_list("pk", flat=True)), [link.pk])
            self.assertFalse(RegisterWalletLinkDecision.objects.exists())

    def test_only_the_preparers_own_authority_upload_can_be_used(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
            prepared(preparer, self.payload(self.evidence, preparing))
        self.assertEqual(self.prepare_as(preparer, preparing).submitted_by_id, preparer.pk)

    def test_revocation_after_a_preview_refuses_the_decision_and_records_nothing(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        link = self.prepared_by_the_owner()
        digest = preview(approver, approving, link, "approve")["preview_digest"]
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        with self.assertRaises(NotFound):
            decide_link(
                actor=approver,
                link_id=link.pk,
                appointment=approving.pk,
                kind="approve",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with use_operator():
            self.assertFalse(RegisterWalletLinkDecision.objects.exists())

    def test_an_approval_whose_approver_lost_the_appointment_must_be_given_again(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        link = self.prepared_by_the_owner()
        client = APIClient()
        client.force_authenticate(self.owner)

        def stage():
            return client.get(f"{LINKS}{link.pk}/").json()["stage"]

        decide(approver, approving, link, "approve")
        self.assertEqual(preview(self.owner, self.administrator, link, "apply")["unmet_requirements"], [])
        self.assertEqual(stage(), "approved")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        self.assertEqual(
            preview(self.owner, self.administrator, link, "apply")["unmet_requirements"], ["approval_lapsed"]
        )
        self.assertEqual(stage(), "submitted")
        with self.assertRaisesMessage(ValidationError, "approval_lapsed"):
            decide(self.owner, self.administrator, link, "apply")
        with self.assertRaisesMessage(ValidationError, "approval_required"):
            decide(self.owner, self.administrator, self.prepared_by_the_owner(), "apply")
        decide(self.owner, self.administrator, link, "approve")
        self.assertEqual(decide(self.owner, self.administrator, link, "apply").status, "applied")
        self.assertEqual(stage(), "applied")

    def test_evidence_whose_bytes_changed_is_refused_before_and_after_preparation(self):
        tampered = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY)
        with private_storage().open(tampered.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        with self.assertRaisesMessage(ValidationError, "no longer matches its record"):
            self.prepared_by_the_owner(authority_evidence=tampered.pk)
        link = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, link, "approve")
        with private_storage().open(link.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        self.assertEqual(
            preview(self.owner, self.administrator, link, "apply")["unmet_requirements"], ["evidence_unavailable"]
        )
        with self.assertRaisesMessage(ValidationError, "evidence_unavailable"):
            decide(self.owner, self.administrator, link, "apply")
        self.assertEqual(decide(self.owner, self.administrator, link, "reject", "The copy changed").status, "rejected")

    def test_an_application_holds_the_company_and_share_class_locks_while_it_records(self):
        probe = connections[MIGRATE_ALIAS].copy(alias="link-lock-probe")
        self.addCleanup(probe.close)
        link = self.prepared_by_the_owner()
        decide(self.owner, self.administrator, link, "approve")
        record = register_openings.record_completed_effects
        observed = []

        def probed(token_id):
            observed.append(locked(probe, self.company, ShareToken(pk=token_id)))
            return record(token_id)

        with patch.object(register_openings, "record_completed_effects", side_effect=probed):
            self.assertEqual(decide(self.owner, self.administrator, link, "apply").status, "applied")
        self.assertEqual(observed, [(True, True)])

    def test_the_api_uploads_prepares_previews_and_decides(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        uploaded = client.post(
            EVIDENCE,
            {
                "company_id": str(self.company.pk),
                "appointment": str(self.administrator.pk),
                "kind": RegisterEvidenceKind.AUTHORITY,
                "idempotency_key": str(uuid4()),
                "file": SimpleUploadedFile("resolution.pdf", DOCUMENT_BYTES, content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        receipt = uploaded.json()
        with use_operator():
            evidence = RegisterEvidence.objects.get(pk=receipt["uuid"])
        payload = self.payload(
            evidence, self.administrator, mapping=[{"address": CAROL, "member": str(self.member.pk)}]
        )
        created = client.post(LINKS, payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(client.post(LINKS, payload, format="json").status_code, 200)
        link = created.json()
        self.assertEqual(
            (link["stage"], link["providedBy"], link["authorityEvidence"], link["preparedByName"], link["decisions"]),
            ("submitted", "company", receipt["uuid"], "Synthetic register owner", []),
        )
        detail = f"{LINKS}{link['uuid']}/"
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
                    "links": [
                        {
                            "address": CAROL,
                            "member": str(self.member.pk),
                            "memberExists": True,
                            "walletProof": None,
                            "holderType": None,
                            "holderName": None,
                        }
                    ],
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
            (result["status"], result["stage"], [row["kind"] for row in result["decisions"]]),
            ("applied", "applied", ["approve", "apply"]),
        )
        with use_operator():
            self.assertEqual(RegisterMemberWallet.objects.get(address=CAROL).member_id, self.member.pk)
        listed = client.get(LINKS, {"company": str(self.company.pk), "status": "applied"}).json()
        self.assertEqual([row["uuid"] for row in listed["results"]], [link["uuid"]])

    def test_the_waiting_wallets_read_counts_each_unlinked_wallet_across_classes_for_preparers_only(self):
        with use_migrate():
            ordinary = ShareToken.objects.get(company=self.company)
            preference = ShareToken.objects.create(
                company=self.company, name="Synthetic preference shares", symbol="PRF", total_supply="1000"
            )
            ShareToken.objects.create(company=self.company, name="Unopened shares", symbol="UNO", total_supply="10")
        holder(DAVE, "Dave Holder", verified=True, company=self.company)
        waiting = {
            ordinary.pk: [
                {"reason": "unlinked", "unlinked_wallets": [CAROL.lower()]},
                {"reason": "unlinked", "unlinked_wallets": [CAROL, DAVE.lower()]},
            ],
            preference.pk: [
                {"reason": "unlinked", "unlinked_wallets": [CAROL]},
                {"reason": "uninstructed", "unlinked_wallets": []},
            ],
        }
        self.enterContext(patch("tokens.services.register_openings.waiting_list", side_effect=waiting.get))
        preparer, _ = self.appoint([CompanyCapability.PREPARE])
        approver, _ = self.appoint([CompanyCapability.APPROVE])
        reader, _ = self.appoint([CompanyCapability.READ_REGISTER])
        with use_operator():
            foreign_administrator = link_fixture()[0]
        expected = {
            "wallets": [
                {"address": CAROL, "waiting": 3, "walletProof": None, "holderType": None, "holderName": None},
                {
                    "address": DAVE,
                    "waiting": 1,
                    "walletProof": "proven",
                    "holderType": "member",
                    "holderName": "Dave Holder",
                },
            ]
        }
        query = {"company": str(self.company.pk)}
        for actor in (self.owner, preparer):
            with self.subTest(actor=actor.email):
                self.client.force_authenticate(actor)
                read = self.client.get(WAITING, query)
                self.assertEqual((read.status_code, read.json()), (200, expected))
        unknown = self.client.get(WAITING, {"company": str(uuid4())})
        for actor in (approver, reader, staff_user(), foreign_administrator):
            with self.subTest(actor=actor.email):
                self.client.force_authenticate(actor)
                denied = self.client.get(WAITING, query)
                self.assertEqual((denied.status_code, denied.content), (unknown.status_code, unknown.content))
                self.assertEqual(denied.status_code, 404)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(WAITING, {"company": "not-a-uuid"}).status_code, 400)
        self.assertEqual(self.client.get(WAITING).status_code, 400)
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        self.assertEqual(self.client.get(WAITING, query).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(WAITING, query).status_code, 401)


class RegisterWalletLinkDecisionGuardTest(LinkAuthorityFixture, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.link = self.prepared_by_the_owner()

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def test_the_database_admits_a_preparation_only_through_the_command_from_the_preparers_own_upload(self):
        forged = forged_fields(self.link)
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        _, reading = self.appoint([CompanyCapability.READ_REGISTER])
        theirs = upload_evidence(preparer, preparing, RegisterEvidenceKind.AUTHORITY)

        def without_a_command():
            forged_id = uuid4()
            with use_operator(), atomic():
                RegisterWalletLink.objects.create(
                    **{
                        **forged,
                        "uuid": forged_id,
                        "file": f"companies/{self.company.pk}/register-links/{forged_id}/{uuid4()}.bin",
                    }
                )

        for write in (
            without_a_command,
            lambda: insert_forged(forged, self.owner, operation="register_link_approve"),
            lambda: insert_forged(forged, self.owner, scope=uuid4()),
            lambda: insert_forged(forged, self.owner, preparing_appointment=reading),
            lambda: insert_forged(forged, preparer, submitted_by=preparer, preparing_appointment=preparing),
            lambda: insert_forged(
                forged,
                self.owner,
                authority_evidence=theirs,
                evidence_fingerprint=theirs.sha256,
                evidence_snapshot=evidence_snapshot(theirs),
            ),
            lambda: insert_forged(forged, self.owner, evidence_fingerprint="0" * 64),
            lambda: insert_forged(forged, self.owner, evidence_snapshot={**forged["evidence_snapshot"], "name": "x"}),
            lambda: insert_forged(forged, self.owner, mapping=[]),
            lambda: insert_forged(forged, self.owner, status="applied"),
        ):
            self.assert_refused(PREPARATION_REFUSED, write)
        self.assert_refused(
            "register_wallet_link_exact_provenance", lambda: insert_forged(forged, self.owner, source_document=uuid4())
        )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner)
            raise RuntimeError("rollback")

    def test_the_database_admits_only_exact_current_company_decisions(self):
        stranger = person(f"stranger-{uuid4()}@example.test")
        retained = staff_era(self.prepared_by_the_owner())
        for write in (
            lambda: forge_decision(self.link, "apply", self.owner, self.administrator),
            lambda: forge_decision(self.link, "approve", self.owner, self.administrator, digest="0" * 64),
            lambda: forge_decision(self.link, "reject", self.owner, self.administrator),
            lambda: forge_decision(self.link, "approve", self.owner, self.administrator, reason="No"),
            lambda: forge_decision(self.link, "approve", stranger, self.administrator),
            lambda: forge_decision(retained, "approve", self.owner, self.administrator),
        ):
            self.assert_refused(COMMAND_REFUSED, write)
        for operation, scope in (("register_link_apply", self.company.pk), ("register_link_approve", uuid4())):
            with self.subTest(operation=operation), company_operation(self.owner, scope, operation):
                with self.assertRaisesMessage(DatabaseError, COMMAND_REFUSED), atomic():
                    RegisterWalletLinkDecision.objects.create(
                        register_wallet_link=self.link,
                        kind="approve",
                        decided_by=self.owner,
                        appointment=self.administrator,
                        idempotency_key=uuid4(),
                        digest=decision_digest(self.link, "approve", self.owner, self.administrator),
                        decided_at=timezone.now(),
                    )
        approval = forge_decision(self.link, "approve", self.owner, self.administrator)
        self.assert_refused(
            COMMAND_REFUSED, lambda: forge_decision(self.link, "approve", self.owner, self.administrator)
        )
        with company_operation(self.owner, self.company.pk, "register_link_approve"):
            for write in (
                lambda: RegisterWalletLinkDecision.objects.filter(pk=approval.pk).update(reason="Rewritten"),
                lambda: RegisterWalletLinkDecision.objects.filter(pk=approval.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "append-only"), atomic():
                    write()

    def test_the_database_admits_each_step_only_from_an_appointment_holding_it(self):
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        applier, applying = self.appoint([CompanyCapability.APPLY])
        for actor, appointment, kind, reason in (
            (reader, reading, "approve", ""),
            (preparer, preparing, "approve", ""),
            (applier, applying, "approve", ""),
            (preparer, preparing, "reject", "Not mine to reject"),
        ):
            with self.subTest(decided_by=actor.email, kind=kind):
                self.assert_refused(
                    COMMAND_REFUSED, lambda: forge_decision(self.link, kind, actor, appointment, reason=reason)
                )
        forge_decision(self.link, "approve", approver, approving)
        self.assert_refused(COMMAND_REFUSED, lambda: forge_decision(self.link, "apply", approver, approving))

    def test_the_application_digest_binds_the_current_links_of_the_mapped_addresses(self):
        approval = decision_digest(self.link, "approve", self.owner, self.administrator)
        application = decision_digest(self.link, "apply", self.owner, self.administrator)
        forge_decision(self.link, "approve", self.owner, self.administrator)
        with use_operator():
            other = create_member(company_id=self.company.pk, member_id=uuid4())
            RegisterMemberWallet.objects.create(company=self.company, member=other, address=DAVE)
            self.assertEqual(decision_digest(self.link, "apply", self.owner, self.administrator), application)
            RegisterMemberWallet.objects.create(company=self.company, member=other, address=CAROL.lower())
            self.assertNotEqual(decision_digest(self.link, "apply", self.owner, self.administrator), application)
            self.assertEqual(decision_digest(self.link, "approve", self.owner, self.administrator), approval)
        self.assert_refused(
            COMMAND_REFUSED,
            lambda: forge_decision(self.link, "apply", self.owner, self.administrator, digest=application),
        )

    def test_an_outcome_needs_its_own_decision_and_a_decision_needs_its_own_outcome(self):
        approval = forge_decision(self.link, "approve", self.owner, self.administrator)
        self.assert_refused(
            OUTCOME_REFUSED,
            lambda: forge_outcome(self.link, self.owner, approval, status="rejected", rejection_reason="Forged"),
        )
        with self.assertRaisesMessage(DatabaseError, "carry exactly its own effect"), use_operator(), atomic():
            forge_decision(self.link, "reject", self.owner, self.administrator, reason="Without effect")
        with self.assertRaisesMessage(DatabaseError, "link every mapped wallet"), use_operator(), atomic():
            application = forge_decision(self.link, "apply", self.owner, self.administrator)
            forge_outcome(self.link, self.owner, application, status="applied")
        with self.assertRaisesMessage(DatabaseError, OUTCOME_REFUSED), use_operator(), atomic():
            rejection = forge_decision(self.link, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.link, self.owner, rejection, status="rejected", rejection_reason="Different")
        with use_operator(), atomic():
            rejection = forge_decision(self.link, "reject", self.owner, self.administrator, reason="Exact")
            forge_outcome(self.link, self.owner, rejection, status="rejected", rejection_reason="Exact")
        with use_operator():
            self.link.refresh_from_db()
        self.assertEqual((self.link.status, self.link.rejection_reason), ("rejected", "Exact"))

    def test_the_app_role_writes_no_link_outcome_and_no_decision(self):
        app = connection.ops.quote_name(settings.RLS_ROLES["app"])
        with use_migrate(), self.assertRaises(RuntimeError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(f"SET LOCAL ROLE {app}")
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, true), "
                    "set_config('app.company_operation', 'register_link_reject', true), "
                    "set_config('app.company_id', %s, true)",
                    [str(self.owner.pk), str(self.company.pk)],
                )
                for statement, params in (
                    (
                        "UPDATE public.tokens_registerwalletlink SET status = 'rejected', "
                        "rejection_reason = 'Forged', reviewed_by_id = %s, reviewed_at = now() WHERE uuid = %s",
                        [self.owner.pk, self.link.pk],
                    ),
                    (
                        "INSERT INTO public.tokens_registerwalletlinkdecision (uuid, created_at, updated_at, "
                        "register_wallet_link_id, kind, decided_by_id, appointment_id, idempotency_key, digest, "
                        "reason, decided_at) VALUES (%s, now(), now(), %s, 'reject', %s, %s, %s, %s, 'Forged', now())",
                        [uuid4(), self.link.pk, self.owner.pk, self.administrator.pk, uuid4(), "0" * 64],
                    ),
                ):
                    with self.subTest(statement=statement.split()[0]):
                        with self.assertRaisesMessage(DatabaseError, "permission denied"), atomic():
                            cursor.execute(statement, params)
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterWalletLink.objects.get(pk=self.link.pk).status, "submitted")

    def test_a_temporary_table_cannot_stand_in_for_the_decision_table(self):
        operator = connection.ops.quote_name(settings.RLS_ROLES["operator"])
        decided_at = timezone.now()
        with use_migrate(), self.assertRaises(RuntimeError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(f"SET LOCAL ROLE {operator}")
                cursor.execute(
                    "CREATE TEMP TABLE tokens_registerwalletlinkdecision "
                    "(LIKE public.tokens_registerwalletlinkdecision) ON COMMIT DROP"
                )
                cursor.execute(
                    "INSERT INTO pg_temp.tokens_registerwalletlinkdecision (uuid, created_at, updated_at, "
                    "register_wallet_link_id, kind, decided_by_id, appointment_id, idempotency_key, digest, reason, "
                    "decided_at) VALUES (%s, %s, %s, %s, 'reject', %s, %s, %s, %s, 'Forged', %s)",
                    [
                        uuid4(),
                        decided_at,
                        decided_at,
                        self.link.pk,
                        self.owner.pk,
                        self.administrator.pk,
                        uuid4(),
                        "0" * 64,
                        decided_at,
                    ],
                )
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, true), "
                    "set_config('app.company_operation', 'register_link_reject', true), "
                    "set_config('app.company_id', %s, true)",
                    [str(self.owner.pk), str(self.company.pk)],
                )
                with self.assertRaisesMessage(DatabaseError, OUTCOME_REFUSED), atomic():
                    cursor.execute(
                        "UPDATE public.tokens_registerwalletlink SET status = 'rejected', "
                        "rejection_reason = 'Forged', reviewed_by_id = %s, reviewed_at = %s WHERE uuid = %s",
                        [self.owner.pk, decided_at, self.link.pk],
                    )
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(RegisterWalletLink.objects.get(pk=self.link.pk).status, "submitted")


class ScopedRegisterWalletLinkAuthorityTest(RunsOnTheScopedConnection, RegisterWalletLinkAuthorityTest):
    pass


class ScopedRegisterWalletLinkDecisionGuardTest(RunsOnTheScopedConnection, RegisterWalletLinkDecisionGuardTest):
    pass
