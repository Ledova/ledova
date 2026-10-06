import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import Company, CompanyAppointment, CompanyRegistryCheck
from companies.services.authority import DECLARATION_VERSION
from companies.services.authority_requests import _requester_principal
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import STORAGES, evidence
from integrations.abr.client import RegistryObservation
from integrations.kyc.base import (
    KYCProvider,
    NormalizedVerificationResult,
    VerificationSession,
)
from operators.models import Operator
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
    InvestorClassification,
    UserAccount,
)
from users.models.user_account import AccountRole
from users.services.company_eligibility_consumption import (
    NO_LIVE_COMPANY_DECISION,
    company_eligibility,
)

SOURCES = "/api/investor-classifications/"
REQUESTS = "/api/v1/company-eligibility/requests/"
PRIVATE_BASIS = "Synthetic fresh participant private financial position"


class CompanyEligibilityFreshSignupTest(StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        self.enterContext(patch("users.tasks.notifications.send_push_notification"))
        with use_operator():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.investor_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required", "investor_kyc_required"])

    def fresh_signup(self, label, role):
        client = APIClient()
        email = f"fresh-{label}-{uuid4().hex[:8]}@example.test"
        with patch("authentication.services.email_codes.EmailCodeService.generate", return_value="123456"), patch(
            "authentication.services.email_codes.sendgrid_client.send_email", return_value={"success": True}
        ) as delivery:
            signup = client.post(
                "/api/signup/",
                {"email": email, "password": "pw-12345678", "passwordConfirm": "pw-12345678"},
                format="json",
            )
        self.assertEqual(signup.status_code, 201, signup.content)
        self.assertFalse(signup.json()["isEmailVerified"])
        delivery.assert_called_once()
        with use_operator():
            actor = get_user_model().objects.get(email=signup.json()["email"])
            account = UserAccount.objects.select_related("user_profile").get(user_profile__user=actor)
            self.assertEqual(str(account.user_profile_id), signup.json()["uuid"])
            self.assertFalse(actor.is_email_verified)
            self.assertFalse(actor.is_staff)
            self.assertFalse(actor.is_superuser)
            self.assertFalse(actor.groups.exists())
            self.assertFalse(actor.user_permissions.exists())
            self.assertFalse(account.user_profile.is_id_verified)
            self.assertEqual(account.account_status, "pending")
            self.assertEqual(account.role, AccountRole.INVESTOR)
        verified = client.post("/api/email-verification/", {"email": email, "token": "123456"}, format="json")
        self.assertEqual(verified.status_code, 200, verified.content)
        self.assertTrue(verified.json()["isEmailVerified"])
        client.credentials(HTTP_AUTHORIZATION="Bearer " + verified.cookies["access"].value)
        selected = client.patch(reverse("user-accounts-detail", args=[account.pk]), {"role": role}, format="json")
        self.assertEqual(selected.status_code, 200, selected.content)
        completed = client.patch(
            reverse("user-profiles-detail", args=[account.user_profile_id]),
            {"fullName": f"Synthetic {label}", "isSignupCompleted": True},
            format="json",
        )
        self.assertEqual(completed.status_code, 200, completed.content)
        with use_operator():
            actor.refresh_from_db()
            account.refresh_from_db()
            account.user_profile.refresh_from_db()
        self.assertTrue(actor.is_email_verified)
        self.assertEqual(account.role, role)
        self.assertFalse(account.user_profile.is_id_verified)
        return client, actor, account

    def simulated_identity_provider(self, label):
        provider = Mock(spec=KYCProvider)
        provider.get_provider_name.return_value = "kycaid"
        provider.create_applicant.return_value = {"applicant_id": f"synthetic-fresh-{label}"}
        provider.generate_session.return_value = VerificationSession(
            provider="kycaid", applicant_id=f"synthetic-fresh-{label}", form_url="https://example.test/identity"
        )
        provider.with_approval_evidence.side_effect = lambda applicant, result: result
        provider.get_applicant_data.return_value = {}
        provider.extract_verified_data.return_value = {}
        return provider

    def identity_status(self, client, provider):
        with patch("users.services.identity.get_kyc_provider", return_value=provider):
            response = client.get("/api/users/identity-verification/status/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def begin_identity(self, client, provider):
        with patch("users.services.identity.get_kyc_provider", return_value=provider):
            response = client.post("/api/users/identity-verification/token/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["applicantId"], provider.generate_session.return_value.applicant_id)
        provider.create_applicant.assert_called_once()

    def complete_identity(self, client, provider, account):
        provider.get_applicant_status.side_effect = None
        provider.get_applicant_status.return_value = {"synthetic": "approved"}
        provider.normalize_status.return_value = NormalizedVerificationResult(
            verification_status="completed", review_result="GREEN", is_verified=True
        )
        self.assertTrue(self.identity_status(client, provider)["isVerified"])
        with use_operator():
            account.refresh_from_db()
            account.user_profile.refresh_from_db()
        self.assertTrue(account.user_profile.is_id_verified)
        self.assertIsNotNone(account.user_profile.verified_at)
        self.assertEqual(account.account_status, "active")

    def activated_company(self, client):
        created = client.post(
            "/api/v1/companies/",
            {
                "name": "Fresh Eligibility Pty Ltd",
                "acn": "987654320",
                "company_type": "pty",
                "primary_contact": {"first_name": "Synthetic", "last_name": "Representative"},
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        with use_operator():
            company = Company.objects.get(pk=created.json()["company"]["uuid"])
        proposal = client.post(
            "/api/v1/company-authority/requests/",
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "file": evidence(),
                "requested_capabilities": ["admin", "prepare", "approve"],
                "delegatable_capabilities": [],
            },
            format="multipart",
        )
        self.assertEqual(proposal.status_code, 201, proposal.content)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            admitted = client.post(
                f"/api/v1/company-authority/requests/{proposal.json()['uuid']}/admit/",
                {"declaration_version": DECLARATION_VERSION, "accept_declaration": True},
                format="json",
            )
        self.assertEqual(admitted.status_code, 200, admitted.content)
        self.assertEqual(admitted.json()["verificationStatus"], "self_declared")
        self.assertIn("Company information is provided by the company", admitted.json()["verificationMessage"])
        self.assertNotIn("verified by Ledova", admitted.json()["verificationMessage"])
        detail = client.get(f"/api/v1/companies/{company.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        readiness = detail.json()["activation"]
        with use_operator():
            appointment = CompanyAppointment.objects.get(pk=readiness["appointment"])
        payload = {
            "appointment": str(appointment.pk),
            "lifecycle_revision": readiness["lifecycleRevision"],
            "declaration_version": readiness["declarationVersion"],
            "accept_declaration": True,
        }
        with patch("companies.services.registry.lookup_company") as provider:
            for reason, status in (("timeout", "pending"), ("not_found", "failed")):
                provider.return_value = RegistryObservation(reason=reason)
                response = client.post(
                    f"/api/v1/companies/{company.pk}/activate/",
                    {**payload, "idempotency_key": str(uuid4())},
                    format="json",
                )
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["company"]["status"], "draft")
                self.assertEqual(response.json()["attempt"]["status"], status)
                self.assertEqual(response.json()["attempt"]["reason"], reason)
                self.assertIsNone(response.json()["attempt"]["appliedAt"])
            provider.return_value = matching_observation(company)
            response = client.post(
                f"/api/v1/companies/{company.pk}/activate/",
                {**payload, "idempotency_key": str(uuid4())},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["company"]["status"], "active")
        self.assertIsNotNone(response.json()["attempt"]["appliedAt"])
        with use_operator():
            company.refresh_from_db()
            self.assertEqual(company.registry_check.purpose, "activation")
            self.assertIsNone(company.approved_at)
            self.assertIsNone(company.approved_by_id)
            self.assertEqual(CompanyRegistryCheck.objects.filter(company=company, purpose="activation").count(), 3)
            self.assertFalse(company.documents.exists())
        return company, appointment

    def test_fresh_customer_signup_provider_recovery_and_exact_company_eligibility_without_staff(self):
        owner_client, owner, owner_account = self.fresh_signup("company", AccountRole.COMPANY)
        owner_provider = self.simulated_identity_provider("company")
        self.begin_identity(owner_client, owner_provider)
        owner_provider.get_applicant_status.side_effect = TimeoutError("Simulated identity provider unavailable")
        self.assertFalse(self.identity_status(owner_client, owner_provider)["isVerified"])
        owner_provider.normalize_status.assert_not_called()
        self.complete_identity(owner_client, owner_provider, owner_account)
        company, appointment = self.activated_company(owner_client)
        client, participant, account = self.fresh_signup("participant", AccountRole.INVESTOR)
        provider = self.simulated_identity_provider("participant")
        self.begin_identity(client, provider)
        provider.get_applicant_status.return_value = {"synthetic": "refused"}
        provider.normalize_status.return_value = NormalizedVerificationResult(
            verification_status="completed", review_result="RED", is_verified=False
        )
        identity = self.identity_status(client, provider)
        self.assertFalse(identity["isVerified"])
        self.assertEqual(identity["reviewResult"], "RED")
        source_response = client.post(
            SOURCES,
            {
                "category": "professional_investor",
                "declaration_accepted": "true",
                "declared_basis": PRIVATE_BASIS,
                "evidence_file": SimpleUploadedFile("fresh-private.pdf", pdf_bytes(), content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(source_response.status_code, 201, source_response.content)
        source_id = source_response.json()["uuid"]
        terms = {
            "source": source_id,
            "company": str(company.pk),
            "requested_expires_at": (timezone.now() + timedelta(days=90)).isoformat(),
        }
        preview = client.post(f"{REQUESTS}preview/", terms, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canSubmit"])
        self.assertIn("participant_identity_required", preview.json()["unmetRequirements"])
        self.assertIn("participant_account_inactive", preview.json()["unmetRequirements"])
        refused = client.post(
            REQUESTS,
            {
                **terms,
                "preview_digest": preview.json()["previewDigest"],
                "idempotency_key": str(uuid4()),
                "sharing_accepted": True,
                "declaration_accepted": True,
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.filter(user_account=account).exists())
            account.refresh_from_db()
            account.user_profile.refresh_from_db()
            self.assertEqual(account.account_status, "pending")
            self.assertFalse(account.user_profile.is_id_verified)
        self.complete_identity(client, provider, account)
        readiness = client.get(f"{SOURCES}eligibility/")
        self.assertEqual(readiness.status_code, 200, readiness.content)
        self.assertEqual(readiness.json(), {"isReady": True, "reasons": [], "account": str(account.pk)})
        with use_operator(), _requester_principal(participant.pk):
            outcome = company_eligibility(account, company, purpose="primary")
            self.assertFalse(outcome.is_eligible)
            self.assertEqual(outcome.reasons, (NO_LIVE_COMPANY_DECISION,))
        preview = client.post(f"{REQUESTS}preview/", terms, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertTrue(preview.json()["canSubmit"])
        submitted = client.post(
            REQUESTS,
            {
                **terms,
                "preview_digest": preview.json()["previewDigest"],
                "idempotency_key": str(uuid4()),
                "sharing_accepted": True,
                "declaration_accepted": True,
            },
            format="json",
        )
        self.assertEqual(submitted.status_code, 201, submitted.content)
        self.assertEqual(submitted.json()["outcome"], "pending")
        request_id = submitted.json()["uuid"]
        queue_url = f"/api/v1/companies/{company.pk}/eligibility-requests/{request_id}/"
        shared = owner_client.get(queue_url)
        self.assertEqual(shared.status_code, 200, shared.content)
        for forbidden in (PRIVATE_BASIS, "fresh-private.pdf", "declaredBasis", "evidenceFile", "evidenceUrl"):
            self.assertNotIn(forbidden, json.dumps(shared.json()))
        decision_terms = {
            "appointment": str(appointment.pk),
            "outcome": "accepted",
            "expires_at": terms["requested_expires_at"],
        }
        decision_preview = owner_client.post(queue_url + "decision-preview/", decision_terms, format="json")
        self.assertEqual(decision_preview.status_code, 200, decision_preview.content)
        self.assertTrue(decision_preview.json()["canDecide"])
        decision = owner_client.post(
            queue_url + "decide/",
            {
                **decision_terms,
                "preview_digest": decision_preview.json()["previewDigest"],
                "idempotency_key": str(uuid4()),
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(decision.status_code, 200, decision.content)
        self.assertEqual(decision.json()["outcome"], "accepted")
        with use_operator(), _requester_principal(participant.pk):
            retained = CompanyEligibilityDecision.objects.get(request_id=request_id)
            outcome = company_eligibility(account, company, purpose="primary")
            self.assertTrue(outcome.is_eligible, outcome.reasons)
            self.assertEqual(outcome.decision.pk, retained.pk)
            self.assertEqual(retained.decided_by_id, owner.pk)
            self.assertEqual(retained.appointment_id, appointment.pk)
            self.assertEqual(retained.request.company_id, company.pk)
            self.assertEqual(retained.request.submitted_by_id, participant.pk)
            source = InvestorClassification.objects.get(pk=source_id)
            self.assertEqual(source.status, "submitted")
            self.assertIsNone(source.reviewed_by_id)
            self.assertEqual(source.declared_basis, PRIVATE_BASIS)
            self.assertTrue(Path(source.evidence_file.path).is_relative_to(self.root))
            with self.assertRaises(ValueError):
                source.evidence_file.url
            self.assertFalse(get_user_model().objects.filter(is_staff=True).exists())
            self.assertFalse(owner.groups.exists())
            self.assertFalse(participant.groups.exists())
            self.assertFalse(owner.user_permissions.exists())
            self.assertFalse(participant.user_permissions.exists())
        holder_history = client.get(f"{REQUESTS}{request_id}/")
        self.assertEqual(holder_history.status_code, 200, holder_history.content)
        self.assertEqual(holder_history.json()["outcome"], "accepted")
        self.assertEqual(holder_history.json()["decision"]["uuid"], str(retained.pk))


class ScopedCompanyEligibilityFreshSignupTest(RunsOnTheScopedConnection, CompanyEligibilityFreshSignupTest):
    pass
