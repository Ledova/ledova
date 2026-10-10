import json
import tempfile
from datetime import timedelta
from pathlib import Path
from time import sleep
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyCapability
from companies.services.activation import activate_company
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import submit_authority_request
from companies.services.company import register_company, transition_company
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    AuthorityRequestCases,
    evidence,
)
from documents.models import Document, DocumentExtraction
from operators.models import Operator
from shared.db import use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from users.models import (
    InvestorCategory,
    InvestorClassification,
    InvestorClassificationStatus,
    UserAccount,
    UserProfile,
)
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
    CompanyEligibilityRequestWithdrawal,
    CompanyEligibilityRevocation,
)
from users.models.investor_classification import DECLARATION_TEXT as SOURCE_DECLARATIONS
from users.services.company_eligibility import company_eligibility_requests
from users.tests.factories import make_investor

REQUESTS = "/api/v1/company-eligibility/requests/"
SOURCES = "/api/investor-classifications/"
PDF = pdf_bytes()
PRIVATE_BASIS = "Synthetic private financial position: PRIVATE-BASIS-863"


class CompanyEligibilityCases:
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.owner, self.owner_account = make_investor("eligibility-company-owner")
            self.participant, self.account = make_investor("eligibility-participant")
            self.other, self.other_account = make_investor("eligibility-other-participant")
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.investor_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required", "investor_kyc_required"])
        self.company, self.initial = self.company_fixture("Eligibility Pty Ltd", "123456780")
        self.approver, self.approver_account, self.appointment = self.appointee("approver", ["prepare", "approve"])
        self.client.force_authenticate(self.participant)
        self.source = self.submit_source()
        self.requested_expiry = timezone.now() + timedelta(days=90)
        self.key = uuid4()

    def company_fixture(self, name, acn):
        company = register_company(
            owner=self.owner,
            name=name,
            acn=acn,
            primary_contact_data={"first_name": "Synthetic", "last_name": "Representative"},
        )
        proposal, _ = submit_authority_request(
            requester=self.owner,
            company_id=company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
        )
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            initial = admit_authority_request(
                requester=self.owner,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment
            company, attempt = activate_company(
                actor=self.owner,
                company_id=company.pk,
                idempotency_key=uuid4(),
                appointment=initial.pk,
                lifecycle_revision=company.lifecycle_revision,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        self.assertIsNotNone(attempt.applied_at)
        return company, initial

    def appointee(self, label, capabilities, *, delegatable=None, expires_at=None):
        with use_operator():
            actor, account = make_investor(f"eligibility-{label}")
        appointment = self.appoint_actor(actor, capabilities, delegatable=delegatable, expires_at=expires_at)
        return actor, account, appointment

    def appoint_actor(self, actor, capabilities, *, delegatable=None, expires_at=None):
        invitation, code, created = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.initial.pk,
            idempotency_key=uuid4(),
            capabilities=capabilities,
            delegatable_capabilities=delegatable or [],
            appointment_expires_at=expires_at,
        )
        self.assertTrue(created)
        appointment = accept_team_invitation(
            requester=actor,
            code=code,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        )
        self.assertEqual(appointment.invitation_id, invitation.pk)
        return appointment

    def submit_source(self, *, actor=None, **changes):
        self.client.force_authenticate(actor or self.participant)
        response = self.client.post(
            SOURCES,
            {
                "category": InvestorCategory.PROFESSIONAL_INVESTOR,
                "declaration_accepted": "true",
                "declared_basis": PRIVATE_BASIS,
                "evidence_file": SimpleUploadedFile(
                    "private-financial-position.pdf", PDF, content_type="application/pdf"
                ),
                **changes,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        with use_operator():
            return InvestorClassification.objects.get(pk=response.json()["uuid"])

    def request_terms(self, **changes):
        terms = {
            "source": str(self.source.pk),
            "requested_expires_at": self.requested_expiry.isoformat(),
        }
        if "offering" not in changes:
            terms["company"] = str(self.company.pk)
        return {**terms, **changes}

    def preview(self, **changes):
        return self.client.post(f"{REQUESTS}preview/", self.request_terms(**changes), format="json")

    def create(self, *, digest=None, **changes):
        terms = self.request_terms(**changes)
        if digest is None:
            preview = self.client.post(f"{REQUESTS}preview/", terms, format="json")
            self.assertEqual(preview.status_code, 200, preview.content)
            digest = preview.json()["previewDigest"]
        return self.client.post(
            REQUESTS,
            {
                **terms,
                "preview_digest": digest,
                "idempotency_key": str(self.key),
                "sharing_accepted": True,
                "declaration_accepted": True,
            },
            format="json",
        )

    def created_request(self, **changes):
        response = self.create(**changes)
        self.assertEqual(response.status_code, 201, response.content)
        with use_operator():
            record = CompanyEligibilityRequest.objects.get(pk=response.json()["uuid"])
        return record, response.json()

    def company_url(self, request=None, action=None, *, company=None):
        result = f"/api/v1/companies/{(company or self.company).pk}/eligibility-requests/"
        if request is not None:
            result += f"{request.pk}/"
        if action is not None:
            result += f"{action}/"
        return result

    def decision_terms(self, **changes):
        return {
            "outcome": "accepted",
            "appointment": str(self.appointment.pk),
            "expires_at": self.requested_expiry.isoformat(),
            **changes,
        }

    def decision_preview(self, request, **changes):
        return self.client.post(
            self.company_url(request, "decision-preview"), self.decision_terms(**changes), format="json"
        )

    def decide(self, request, *, digest=None, key=None, confirmation=True, **changes):
        terms = self.decision_terms(**changes)
        if digest is None:
            preview = self.client.post(self.company_url(request, "decision-preview"), terms, format="json")
            self.assertEqual(preview.status_code, 200, preview.content)
            digest = preview.json()["previewDigest"]
        return self.client.post(
            self.company_url(request, "decide"),
            {**terms, "preview_digest": digest, "idempotency_key": str(key or uuid4()), "confirmation": confirmation},
            format="json",
        )

    def accepted_request(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        response = self.decide(request)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["outcome"], "accepted")
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(request=request)
        return request, decision, response.json()

    def snapshots(self):
        with use_operator():
            return {
                model._meta.label: list(model.objects.order_by("uuid").values())
                for model in (
                    CompanyEligibilityRequest,
                    CompanyEligibilityDecision,
                    CompanyEligibilityRequestWithdrawal,
                    CompanyEligibilityRevocation,
                )
            }

    def assert_private_summary(self, body):
        serialized = json.dumps(body)
        for forbidden in (
            PRIVATE_BASIS,
            "private-financial-position.pdf",
            self.source.evidence_file.name,
            "declaredBasis",
            "evidenceFile",
            "evidenceUrl",
            "fileUrl",
            "financialProfile",
            "reviewNotes",
            "rejectionReason",
            "kycaidApplicantId",
            "sumsubApplicantId",
        ):
            self.assertNotIn(forbidden, serialized)


class CompanyEligibilityRequestFixtures(CompanyEligibilityCases, StubUploadDependencies):
    def retained_decision_and_revocation_replay(self, *, expire):
        request, _ = self.created_request()
        if expire:
            expiry = timezone.now() + timedelta(seconds=3)
            actor, _, selected = self.appointee("retained-expiring-approver", ["prepare", "approve"], expires_at=expiry)
        else:
            expiry = None
            actor, selected = self.approver, self.appointment
        self.client.force_authenticate(actor)
        preview = self.decision_preview(request, appointment=str(selected.pk))
        self.assertEqual(preview.status_code, 200, preview.content)
        digest = preview.json()["previewDigest"]
        key = uuid4()
        first = self.decide(request, digest=digest, key=key, appointment=str(selected.pk))
        self.assertEqual(first.status_code, 200, first.content)
        revocation_payload = {
            "appointment": str(selected.pk),
            "idempotency_key": str(uuid4()),
            "reason": "Synthetic retained company revocation",
        }
        revoked = self.client.post(self.company_url(request, "revoke"), revocation_payload, format="json")
        self.assertEqual(revoked.status_code, 200, revoked.content)
        before = self.snapshots()
        if expire:
            wait = (expiry - timezone.now()).total_seconds()
            if wait > 0:
                self.assertLess(wait, 4)
                sleep(wait + 0.05)
        else:
            revoke_company_appointment(requester=actor, appointment_id=selected.pk)
        readable = self.appoint_actor(actor, ["prepare"])
        self.assertNotEqual(readable.pk, selected.pk)
        self.assertEqual(readable.capabilities, ["prepare"])
        self.assertEqual(self.client.get(self.company_url(request)).status_code, 200)
        repeated_decision = self.decide(request, digest=digest, key=key, appointment=str(selected.pk))
        self.assertEqual(repeated_decision.status_code, 200, repeated_decision.content)
        self.assertEqual(repeated_decision.json()["decision"], revoked.json()["decision"])
        self.assertEqual(repeated_decision.json()["decision"]["appointment"], str(selected.pk))
        repeated_revocation = self.client.post(self.company_url(request, "revoke"), revocation_payload, format="json")
        self.assertEqual(repeated_revocation.status_code, 200, repeated_revocation.content)
        self.assertEqual(repeated_revocation.json()["decision"], revoked.json()["decision"])
        self.assertEqual(repeated_revocation.json()["decision"]["revocation"]["appointment"], str(selected.pk))
        changed_appointment = self.decide(request, digest=digest, key=key, appointment=str(readable.pk))
        self.assertEqual(changed_appointment.status_code, 409, changed_appointment.content)
        changed_revocation = self.client.post(
            self.company_url(request, "revoke"), {**revocation_payload, "appointment": str(readable.pk)}, format="json"
        )
        self.assertEqual(changed_revocation.status_code, 409, changed_revocation.content)
        self.assertEqual(self.snapshots(), before)


class CompanyEligibilityRequestTest(CompanyEligibilityRequestFixtures, APITransactionTestCase):
    def test_pending_both_account_can_submit_and_be_accepted_only_with_investor_identity_policy_off(self):
        with use_operator():
            self.participant, self.account = make_investor(
                "eligibility-pending-participant", account_status="pending", id_verified=False, role="both"
            )
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        self.source = self.submit_source()
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertTrue(preview.json()["canSubmit"])
        self.assertEqual(preview.json()["unmetRequirements"], [])
        request, _ = self.created_request()
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=True)
        before = self.snapshots()
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canSubmit"])
        self.assertIn("participant_account_inactive", preview.json()["unmetRequirements"])
        self.assertIn("participant_identity_required", preview.json()["unmetRequirements"])
        self.key = uuid4()
        refused = self.create(digest=preview.json()["previewDigest"])
        self.assertEqual(refused.status_code, 400, refused.content)
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canDecide"])
        self.assertIn("participant_account_inactive", preview.json()["unmetRequirements"])
        refused = self.decide(request, digest=preview.json()["previewDigest"])
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(self.snapshots(), before)
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        accepted = self.decide(request)
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.json()["outcome"], "accepted")
        with use_operator():
            self.account.refresh_from_db()
            self.source.refresh_from_db()
            self.assertEqual(self.account.account_status, "pending")
            self.assertEqual(self.account.role, "both")
            self.assertIsNone(self.account.activation_date)
            self.assertFalse(UserProfile.objects.get(pk=self.account.user_profile_id).is_id_verified)
            self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
            self.assertIsNone(self.source.reviewed_by_id)

    def test_rejected_suspended_and_terminated_accounts_are_refused_under_either_identity_policy(self):
        for required in (False, True):
            for status in ("rejected", "suspended", "terminated"):
                with self.subTest(required=required, status=status):
                    with use_migrate():
                        Operator.objects.filter(pk=1).update(investor_kyc_required=required)
                        UserAccount.objects.filter(pk=self.account.pk).update(account_status=status)
                    preview = self.preview()
                    self.assertEqual(preview.status_code, 200, preview.content)
                    self.assertFalse(preview.json()["canSubmit"])
                    self.assertIn("participant_account_inactive", preview.json()["unmetRequirements"])
                    refused = self.create(digest=preview.json()["previewDigest"])
                    self.assertEqual(refused.status_code, 400, refused.content)
                    with use_operator():
                        self.assertFalse(CompanyEligibilityRequest.objects.exists())
        with use_migrate():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        self.created_request()

    def test_identity_policy_off_still_requires_an_active_email_verified_participant(self):
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        for active, email in ((False, True), (True, False)):
            with self.subTest(active=active, email_verified=email):
                with use_migrate():
                    type(self.participant).objects.filter(pk=self.participant.pk).update(
                        is_active=active, is_email_verified=email
                    )
                preview = self.preview()
                self.assertEqual(preview.status_code, 200, preview.content)
                self.assertFalse(preview.json()["canSubmit"])
                self.assertIn("participant_account_inactive", preview.json()["unmetRequirements"])
                refused = self.create(digest=preview.json()["previewDigest"])
                self.assertEqual(refused.status_code, 400, refused.content)
                with use_operator():
                    self.assertFalse(CompanyEligibilityRequest.objects.exists())
        with use_migrate():
            type(self.participant).objects.filter(pk=self.participant.pk).update(is_active=True, is_email_verified=True)
        self.created_request()

    def test_company_only_participant_account_is_refused_even_with_identity_policy_off(self):
        with use_migrate():
            UserAccount.objects.filter(pk=self.account.pk).update(role="company")
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canSubmit"])
        self.assertIn("participant_investor_account_required", preview.json()["unmetRequirements"])
        refused = self.create(digest=preview.json()["previewDigest"])
        self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())
        with use_migrate():
            UserAccount.objects.filter(pk=self.account.pk).update(role="investor")
        self.created_request()

    def test_missing_operator_configuration_refuses_api_and_company_service_without_recreating_it(self):
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        before = self.snapshots()
        with use_migrate():
            Operator.objects.filter(pk=1).delete()
        unavailable = self.preview()
        self.assertEqual(unavailable.status_code, 503, unavailable.content)
        unavailable = self.create(digest=preview.json()["previewDigest"])
        self.assertEqual(unavailable.status_code, 503, unavailable.content)
        self.client.force_authenticate(self.approver)
        unavailable = self.client.get(self.company_url())
        self.assertEqual(unavailable.status_code, 503, unavailable.content)
        with self.assertRaisesMessage(ImproperlyConfigured, "Company eligibility configuration is missing."):
            company_eligibility_requests(self.approver, self.company.pk)
        with use_operator():
            self.assertFalse(Operator.objects.exists())
        self.assertEqual(self.snapshots(), before)

    def test_preview_is_pure_and_shares_only_the_exact_declared_summary(self):
        response = self.preview()
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["canSubmit"])
        self.assertEqual(body["unmetRequirements"], [])
        self.assertEqual(len(body["evidenceHash"]), 64)
        self.assertEqual(len(body["sourceFingerprint"]), 64)
        self.assertEqual(len(body["previewDigest"]), 64)
        self.assertEqual(body["sharedSummary"]["category"], InvestorCategory.PROFESSIONAL_INVESTOR)
        self.assertEqual(
            body["sharedSummary"]["declarationText"], SOURCE_DECLARATIONS[InvestorCategory.PROFESSIONAL_INVESTOR]
        )
        self.assertEqual(
            set(body["sharedSummary"]),
            {"source", "userAccount", "company", "category", "declarationText", "submittedAt", "requestedExpiresAt"},
        )
        self.assert_private_summary(body)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
            self.assertIsNone(self.source.reviewed_by_id)
            self.assertIsNone(self.source.reviewed_at)

    def test_fresh_request_binds_real_bytes_and_has_no_global_review_or_investment_effect(self):
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        request, body = self.created_request()
        self.assertEqual(body["outcome"], "pending")
        self.assertIsNone(body["decision"])
        self.assertEqual(body["source"], str(self.source.pk))
        self.assertEqual(body["company"], str(self.company.pk))
        self.assertEqual(body["userAccount"], str(self.account.pk))
        self.assertEqual(request.submitted_by_id, self.participant.pk)
        self.assertEqual(request.evidence_hash, preview.json()["evidenceHash"])
        with self.source.evidence_file.open("rb") as retained:
            self.assertEqual(retained.read(), PDF)
        self.assertEqual(request.digest, body["digest"])
        self.assertTrue(request.sharing_accepted)
        self.assertTrue(request.declaration_accepted)
        self.assertIsNone(request.offering_id)
        self.assertIsNone(request.token_id)
        self.assertIsNone(request.quantity)
        self.assert_private_summary(body)
        accepted = self.client.get(f"{SOURCES}eligibility/")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertTrue(accepted.json()["isReady"])
        self.assertNotIn("isEligible", accepted.json())
        self.client.force_authenticate(self.approver)
        decided = self.decide(request)
        self.assertEqual(decided.status_code, 200, decided.content)
        self.client.force_authenticate(self.participant)
        self.assertTrue(self.client.get(f"{SOURCES}eligibility/").json()["isReady"])
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
            self.assertIsNone(self.source.reviewed_by_id)
            self.assertIsNone(self.source.reviewed_at)

    def test_request_requires_actual_sharing_and_declaration_confirmations_and_rejects_claimed_fields(self):
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        payload = {
            **self.request_terms(),
            "preview_digest": preview.json()["previewDigest"],
            "idempotency_key": str(self.key),
            "sharing_accepted": True,
            "declaration_accepted": True,
        }
        for field in ("sharing_accepted", "declaration_accepted"):
            for value in (None, False, "true", 1):
                with self.subTest(field=field, value=value):
                    response = self.client.post(REQUESTS, {**payload, field: value}, format="json")
                    self.assertEqual(response.status_code, 400, response.content)
        for field, value in (
            ("submitted_by", self.other.pk),
            ("user_account", str(self.other_account.pk)),
            ("shared_summary", {"category": "professional_investor"}),
            ("evidence_hash", "0" * 64),
            ("outcome", "accepted"),
        ):
            with self.subTest(field=field):
                response = self.client.post(REQUESTS, {**payload, field: value}, format="json")
                self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(self.client.post(REQUESTS, payload, format="json").status_code, 201)

    def test_actual_evidence_byte_drift_invalidates_the_preview_without_writing_a_request(self):
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        changed = pdf_bytes(width=640)
        self.assertNotEqual(changed, PDF)
        with self.source.evidence_file.open("wb") as retained:
            retained.write(changed)
        refreshed = self.preview()
        self.assertEqual(refreshed.status_code, 200, refreshed.content)
        self.assertNotEqual(refreshed.json()["evidenceHash"], preview.json()["evidenceHash"])
        self.assertNotEqual(refreshed.json()["sourceFingerprint"], preview.json()["sourceFingerprint"])
        response = self.create(digest=preview.json()["previewDigest"])
        self.assertEqual(response.status_code, 409, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())

    def test_first_request_freezes_supporting_attachment_set_and_keeps_private_extraction_hidden(self):
        supporting = pdf_bytes(width=641)
        with patch("documents.services.document.extract_document.defer"):
            uploaded = self.client.post(
                "/api/v1/documents/",
                {
                    "file": SimpleUploadedFile(
                        "synthetic-private-payslip.pdf", supporting, content_type="application/pdf"
                    ),
                    "classification": str(self.source.pk),
                },
                format="multipart",
            )
        self.assertEqual(uploaded.status_code, 202, uploaded.content)
        with use_operator():
            document = Document.objects.get(pk=uploaded.json()["uuid"])
            DocumentExtraction.objects.create(
                document=document,
                status="succeeded",
                raw_output="SYNTHETIC-PRIVATE-EXTRACTION-863",
                parsed_json={"gross_pay": "1234.00"},
            )
        request, body = self.created_request()
        self.client.force_authenticate(self.approver)
        queued = self.client.get(self.company_url(request))
        self.assertEqual(queued.status_code, 200, queued.content)
        self.assert_private_summary(queued.json())
        for value in ("SYNTHETIC-PRIVATE-EXTRACTION-863", "grossPay", "1234.00", document.file.name):
            self.assertNotIn(value, json.dumps(queued.json()))
        self.client.force_authenticate(self.participant)
        url = f"/api/v1/documents/{document.pk}/attach/"
        repeated = self.client.post(url, {"classification": str(self.source.pk)}, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.content)
        with patch("documents.services.document.extract_document.defer"):
            additional = self.client.post(
                "/api/v1/documents/",
                {"file": SimpleUploadedFile("another-private-payslip.pdf", PDF, content_type="application/pdf")},
                format="multipart",
            )
        self.assertEqual(additional.status_code, 202, additional.content)
        new_url = f"/api/v1/documents/{additional.json()['uuid']}/attach/"
        refused = self.client.post(new_url, {"classification": str(self.source.pk)}, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertEqual(list(self.source.supporting_documents.values_list("pk", flat=True)), [document.pk])
            self.assertEqual(CompanyEligibilityRequest.objects.get(pk=request.pk).evidence_hash, body["evidenceHash"])
            self.assertIsNone(Document.objects.get(pk=additional.json()["uuid"]).classification_id)
            with document.file.open("rb") as retained:
                self.assertEqual(retained.read(), supporting)

    def test_foreign_source_unknown_company_and_no_company_cannot_supply_a_context(self):
        foreign = self.submit_source(actor=self.other)
        self.client.force_authenticate(self.participant)
        for changes, status in (
            ({"source": str(foreign.pk)}, 404),
            ({"company": str(uuid4())}, 404),
            ({"company": None}, 400),
            ({"company": "not-a-company"}, 400),
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.preview(**changes).status_code, status)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())

    def test_acceptance_records_the_person_and_appointment_while_preserving_the_request(self):
        request, _ = self.created_request()
        with use_operator():
            before = CompanyEligibilityRequest.objects.filter(pk=request.pk).values().get()
        self.client.force_authenticate(self.approver)
        response = self.decide(request)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["outcome"], "accepted")
        self.assertEqual(body["decision"]["decidedBy"], self.approver.pk)
        self.assertEqual(body["decision"]["appointment"], str(self.appointment.pk))
        self.assertEqual(body["decision"]["requestDigest"], request.digest)
        self.assertIsNone(body["decision"]["revocation"])
        self.assertFalse(self.approver.is_staff)
        self.assert_private_summary(body)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.filter(pk=request.pk).values().get(), before)
            self.assertEqual(CompanyEligibilityDecision.objects.filter(request=request).count(), 1)
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.get(f"{REQUESTS}{request.pk}/").json(), body)

    def test_personal_prepare_previews_and_reads_but_cannot_decide_approve_can_decide_alone(self):
        request, _ = self.created_request()
        preparer, _, prepare = self.appointee("prepare-only", ["prepare"])
        approver, _, approve = self.appointee("approve-only", ["approve"])
        self.client.force_authenticate(preparer)
        queue = self.client.get(self.company_url())
        self.assertEqual(queue.status_code, 200, queue.content)
        self.assertEqual([row["uuid"] for row in queue.json()["results"]], [str(request.pk)])
        preview = self.decision_preview(request, appointment=str(prepare.pk))
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canDecide"])
        self.assertEqual(preview.json()["unmetRequirements"], ["personal_approve_required"])
        denied = self.decide(request, digest=preview.json()["previewDigest"], appointment=str(prepare.pk))
        self.assertEqual(denied.status_code, 404, denied.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        self.client.force_authenticate(approver)
        accepted = self.decide(request, appointment=str(approve.pk))
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.json()["decision"]["decidedBy"], approver.pk)

    def test_admin_owner_staff_and_delegation_only_do_not_get_company_queue_authority(self):
        request, _ = self.created_request()
        delegated, _, appointment = self.appointee("delegation-only", [], delegatable=["prepare", "approve"])
        with use_operator():
            self.other.is_staff = True
            self.other.save(update_fields=["is_staff"])
        for actor, acting in ((self.owner, self.initial), (self.other, self.initial), (delegated, appointment)):
            with self.subTest(actor=actor.pk):
                self.client.force_authenticate(actor)
                self.assertEqual(self.client.get(self.company_url()).status_code, 404)
                self.assertEqual(self.client.get(self.company_url(request)).status_code, 404)
                self.assertEqual(self.decision_preview(request, appointment=str(acting.pk)).status_code, 404)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())

    def test_exact_company_and_request_context_prevents_cross_company_reads_and_decisions(self):
        request, _ = self.created_request()
        foreign, _ = self.company_fixture("Other Eligibility Pty Ltd", "004085616")
        self.client.force_authenticate(self.approver)
        before = self.snapshots()
        for suffix in (None, "decision-preview", "decide", "revoke"):
            with self.subTest(suffix=suffix):
                url = self.company_url(request, suffix, company=foreign)
                response = self.client.get(url) if suffix is None else self.client.post(url, {}, format="json")
                self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(self.snapshots(), before)

    def test_another_participant_cannot_list_read_or_withdraw_the_request(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.other)
        response = self.client.get(REQUESTS)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"], [])
        self.assertEqual(self.client.get(f"{REQUESTS}{request.pk}/").status_code, 404)
        self.assertEqual(
            self.client.post(
                f"{REQUESTS}{request.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
            ).status_code,
            404,
        )
        with use_operator():
            self.assertFalse(CompanyEligibilityRequestWithdrawal.objects.exists())

    def test_request_retry_returns_one_record_and_changed_target_conflicts(self):
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        first = self.create(digest=preview.json()["previewDigest"])
        repeated = self.create(digest=preview.json()["previewDigest"])
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(first.json(), repeated.json())
        foreign, _ = self.company_fixture("Retry Eligibility Pty Ltd", "004085616")
        changed = self.create(company=str(foreign.pk))
        self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)

    def test_identical_own_request_retry_after_actual_issuer_suspension_returns_retained_result(self):
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        digest = preview.json()["previewDigest"]
        first = self.create(digest=digest)
        self.assertEqual(first.status_code, 201, first.content)
        before = self.snapshots()
        with use_operator():
            technical, _ = make_investor("eligibility-technical-suspension", staff=True)
        suspended = transition_company(
            self.company, "suspend", actor=technical, reason="Synthetic technical suspension"
        )
        self.assertEqual(suspended.status, "suspended")
        repeated = self.create(digest=digest)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(repeated.json(), first.json())
        self.assertEqual(self.snapshots(), before)

    def test_decision_requires_an_actual_explicit_confirmation_after_preview(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        digest = preview.json()["previewDigest"]
        key = uuid4()
        payload = {**self.decision_terms(), "preview_digest": digest, "idempotency_key": str(key)}
        missing = self.client.post(self.company_url(request, "decide"), payload, format="json")
        self.assertEqual(missing.status_code, 400, missing.content)
        for confirmation in (False, None, "true", 1):
            with self.subTest(confirmation=confirmation):
                refused = self.decide(request, digest=digest, key=key, confirmation=confirmation)
                self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        accepted = self.decide(request, digest=digest, key=key, confirmation=True)
        self.assertEqual(accepted.status_code, 200, accepted.content)

    def test_identical_decision_and_revocation_retry_keeps_revoked_original_appointment_with_current_prepare_read(self):
        self.retained_decision_and_revocation_replay(expire=False)

    def test_identical_decision_and_revocation_retry_keeps_expired_original_appointment_with_current_prepare_read(self):
        self.retained_decision_and_revocation_replay(expire=True)

    def test_refused_company_request_cannot_receive_a_new_participant_withdrawal(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        response = self.decide(request, outcome="refused", expires_at=None, reason="Synthetic company refusal")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["outcome"], "refused")
        before = self.snapshots()
        self.client.force_authenticate(self.participant)
        withdrawal = self.client.post(
            f"{REQUESTS}{request.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
        )
        self.assertEqual(withdrawal.status_code, 400, withdrawal.content)
        self.assertEqual(self.snapshots(), before)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequestWithdrawal.objects.exists())

    def test_decision_retry_preserves_accepted_history_after_source_withdrawal_and_changed_terms_conflict(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        digest = preview.json()["previewDigest"]
        key = uuid4()
        first = self.decide(request, digest=digest, key=key)
        self.assertEqual(first.status_code, 200, first.content)
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.delete(f"{SOURCES}{self.source.pk}/").status_code, 204)
        self.client.force_authenticate(self.approver)
        repeated = self.decide(request, digest=digest, key=key)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(repeated.json()["decision"], first.json()["decision"])
        changed = self.decide(
            request, digest=digest, key=key, expires_at=(self.requested_expiry - timedelta(days=1)).isoformat()
        )
        self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator():
            self.assertEqual(CompanyEligibilityDecision.objects.count(), 1)

    def test_request_withdrawal_is_retained_replayable_and_does_not_rewrite_acceptance(self):
        request, decision, _ = self.accepted_request()
        with use_operator():
            before = CompanyEligibilityDecision.objects.filter(pk=decision.pk).values().get()
        self.client.force_authenticate(self.participant)
        payload = {"idempotency_key": str(uuid4())}
        url = f"{REQUESTS}{request.pk}/withdraw/"
        first = self.client.post(url, payload, format="json")
        repeated = self.client.post(url, payload, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(first.json(), repeated.json())
        self.assertEqual(first.json()["outcome"], "withdrawn")
        self.assertEqual(first.json()["withdrawal"]["withdrawnBy"], self.participant.pk)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequestWithdrawal.objects.filter(request=request).count(), 1)
            self.assertEqual(CompanyEligibilityDecision.objects.filter(pk=decision.pk).values().get(), before)

    def test_company_revocation_retains_the_deciding_person_and_separate_revoker(self):
        request, decision, body = self.accepted_request()
        actor, _, appointment = self.appointee("revoker", ["approve"])
        self.client.force_authenticate(actor)
        payload = {
            "appointment": str(appointment.pk),
            "idempotency_key": str(uuid4()),
            "reason": "Synthetic mandate ended",
        }
        url = self.company_url(request, "revoke")
        first = self.client.post(url, payload, format="json")
        repeated = self.client.post(url, payload, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(first.json(), repeated.json())
        self.assertEqual(first.json()["outcome"], "revoked")
        self.assertEqual(first.json()["decision"]["decidedBy"], body["decision"]["decidedBy"])
        self.assertEqual(first.json()["decision"]["revocation"]["revokedBy"], actor.pk)
        changed = self.client.post(url, {**payload, "reason": "Changed reason"}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator():
            self.assertEqual(CompanyEligibilityDecision.objects.get(pk=decision.pk).decided_by_id, self.approver.pk)
            self.assertEqual(CompanyEligibilityRevocation.objects.filter(decision=decision).count(), 1)

    def test_source_withdrawal_records_its_actual_holder_and_stops_a_new_acceptance(self):
        request, _ = self.created_request()
        before = timezone.now()
        response = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.WITHDRAWN)
            self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
            self.assertIsNone(self.source.reviewed_by_id)
            self.assertGreaterEqual(self.source.reviewed_at, before)
            with self.source.evidence_file.open("rb") as retained:
                self.assertEqual(retained.read(), PDF)
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        response = self.decide(request, digest=preview.json()["previewDigest"])
        self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())

    def test_missing_real_evidence_refuses_acceptance_without_inventing_a_revocation(self):
        request, _ = self.created_request()
        self.source.evidence_file.storage.delete(self.source.evidence_file.name)
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canDecide"])
        self.assertIn("source_evidence_unavailable", preview.json()["unmetRequirements"])
        response = self.decide(request, digest=preview.json()["previewDigest"])
        self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertFalse(CompanyEligibilityRevocation.objects.exists())
            self.assertEqual(CompanyEligibilityRequest.objects.filter(pk=request.pk).count(), 1)

    def test_actual_decision_expiry_derives_outcome_and_preserves_the_acceptance_record(self):
        request, _ = self.created_request()
        expiry = timezone.now() + timedelta(seconds=3)
        self.client.force_authenticate(self.approver)
        response = self.decide(request, expires_at=expiry.isoformat())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["outcome"], "accepted")
        with use_operator():
            before = CompanyEligibilityDecision.objects.filter(request=request).values().get()
        wait = (expiry - timezone.now()).total_seconds()
        if wait > 0:
            self.assertLess(wait, 4)
            sleep(wait + 0.05)
        self.client.force_authenticate(self.participant)
        expired = self.client.get(f"{REQUESTS}{request.pk}/")
        self.assertEqual(expired.status_code, 200, expired.content)
        self.assertEqual(expired.json()["outcome"], "expired")
        self.assertEqual(expired.json()["decision"], response.json()["decision"])
        with use_operator():
            self.assertEqual(CompanyEligibilityDecision.objects.filter(request=request).values().get(), before)
            self.assertFalse(CompanyEligibilityRevocation.objects.exists())

    def test_refusal_can_record_missing_participant_identity_but_acceptance_cannot(self):
        request, _ = self.created_request()
        with use_operator():
            UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        accepted = self.decide(request, digest=preview.json()["previewDigest"])
        self.assertEqual(accepted.status_code, 400, accepted.content)
        refused = self.decide(request, outcome="refused", expires_at=None, reason="Synthetic identity is not current")
        self.assertEqual(refused.status_code, 200, refused.content)
        self.assertEqual(refused.json()["outcome"], "refused")
        self.assertIsNone(refused.json()["decision"]["expiresAt"])
        self.assertEqual(refused.json()["decision"]["reason"], "Synthetic identity is not current")
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
            self.assertIsNone(self.source.reviewed_by_id)

    def test_copied_appointment_and_lost_approver_identity_cannot_commit_a_preview(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        self.assertEqual(self.decision_preview(request, appointment=str(self.initial.pk)).status_code, 404)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        with use_operator():
            UserProfile.objects.filter(pk=self.approver_account.user_profile_id).update(is_id_verified=False)
        response = self.decide(request, digest=preview.json()["previewDigest"])
        self.assertEqual(response.status_code, 404, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())

    def test_revoked_appointment_cannot_commit_its_old_decision_preview(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        revoke_company_appointment(requester=self.approver, appointment_id=self.appointment.pk)
        response = self.decide(request, digest=preview.json()["previewDigest"])
        self.assertEqual(response.status_code, 404, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())

    def test_real_appointment_expiry_after_preview_refuses_a_new_decision(self):
        request, _ = self.created_request()
        expiry = timezone.now() + timedelta(seconds=2)
        actor, _, appointment = self.appointee("expires", ["approve"], expires_at=expiry)
        self.client.force_authenticate(actor)
        preview = self.decision_preview(request, appointment=str(appointment.pk))
        self.assertEqual(preview.status_code, 200, preview.content)
        wait = (expiry - timezone.now()).total_seconds()
        if wait > 0:
            self.assertLess(wait, 3)
            sleep(wait + 0.05)
        response = self.decide(request, digest=preview.json()["previewDigest"], appointment=str(appointment.pk))
        self.assertEqual(response.status_code, 404, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())

    def test_expiry_beyond_requested_context_and_refusal_without_reason_are_refused(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        for changes in (
            {"expires_at": (self.requested_expiry + timedelta(seconds=1)).isoformat()},
            {"expires_at": (timezone.now() - timedelta(seconds=1)).isoformat()},
            {"outcome": "refused", "expires_at": None, "reason": ""},
            {"outcome": "refused", "expires_at": None, "reason": " "},
            {"outcome": "refused", "reason": "Synthetic refusal"},
            {"reason": "An acceptance is not a refusal"},
        ):
            with self.subTest(changes=changes):
                response = self.decision_preview(request, **changes)
                if changes.get("outcome") == "refused" or changes.get("reason"):
                    self.assertEqual(response.status_code, 400, response.content)
                else:
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertFalse(response.json()["canDecide"])
                    refused = self.decide(request, digest=response.json()["previewDigest"], **changes)
                    self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
