from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from companies.exceptions import IssuerIdentityVerificationRequiredException
from companies.models import (
    LISTING_REQUIRED_DOCUMENTS,
    Company,
    CompanyDocument,
    CompanyStatus,
)
from companies.services import company as company_service
from companies.services import transition_company
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from companies.tests.test_registry_verification import PROVIDER, STORAGES
from operators.models import Operator
from users.models import UserProfile

User = get_user_model()


@override_settings(STORAGES=STORAGES, ABR_AUTH_GUID="")
class IssuerIdentityGateTest(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="gate-owner@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(user=self.owner, full_name="Gate Owner")
        self.operator = User.objects.create_superuser(email="gate-operator@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=self.owner, name="Gate Example Pty Ltd", acn="123456780")
        self.lookup = patch(PROVIDER, return_value=matching_observation(self.company)).start()
        patch("companies.services.company.send_push_notification").start()
        self.addCleanup(patch.stopall)

    def require(self, required):
        operator = Operator.get()
        operator.issuer_kyc_required = required
        operator.save(update_fields=["issuer_kyc_required"])

    def verify(self, verified):
        UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=verified)

    def set_status(self, status):
        Company.objects.filter(pk=self.company.pk).update(status=status)
        self.company.refresh_from_db()

    def transition(self, method, **kwargs):
        actor = self.operator if method not in ("submit", "resubmit") else None
        return transition_company(self.company, method, actor=actor, declaration=DECLARATION, **kwargs)

    def test_an_unverified_owner_cannot_submit_or_resubmit_while_the_switch_is_on(self):
        self.require(True)
        for status, method, kwargs in (
            (CompanyStatus.DRAFT, "submit", {"submitted_by": self.owner}),
            (CompanyStatus.INFO_REQUIRED, "resubmit", {"response": "Uploaded"}),
        ):
            with self.subTest(method=method):
                self.set_status(status)
                with self.assertRaises(IssuerIdentityVerificationRequiredException):
                    self.transition(method, **kwargs)
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, status)
                self.verify(True)
                self.assertEqual(self.transition(method, **kwargs).status, CompanyStatus.SUBMITTED)
                self.verify(False)

    def test_activation_refuses_an_unverified_owner_before_the_registry_is_asked(self):
        self.require(True)
        for method in ("activate", "set_active"):
            with self.subTest(method=method):
                self.set_status(CompanyStatus.APPROVED)
                asked = self.lookup.call_count
                with self.assertRaises(IssuerIdentityVerificationRequiredException):
                    self.transition(method)
                self.company.refresh_from_db()
                self.assertEqual((self.company.status, self.lookup.call_count), (CompanyStatus.APPROVED, asked))
                self.verify(True)
                self.assertEqual(self.transition(method).status, CompanyStatus.ACTIVE)
                self.verify(False)

    def test_an_unverified_owner_does_not_stop_a_warning_resolution_or_a_reinstatement(self):
        self.require(True)
        self.set_status(CompanyStatus.APPROVED)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            self.transition("activate")
        for predecessor, method in (
            (CompanyStatus.WARNING, "resolve_warning"),
            (CompanyStatus.SUSPENDED, "reinstate"),
            (CompanyStatus.WARNING, "set_active"),
            (CompanyStatus.SUSPENDED, "set_active"),
        ):
            with self.subTest(predecessor=predecessor, method=method):
                self.set_status(predecessor)
                self.assertEqual(self.transition(method).status, CompanyStatus.ACTIVE)

    def test_verification_withdrawn_during_the_registry_check_still_refuses_activation(self):
        self.require(True)
        self.verify(True)
        self.set_status(CompanyStatus.APPROVED)
        original = company_service.perform_registry_check

        def withdraw_verification(check):
            self.verify(False)
            return original(check)

        with (
            patch.object(company_service, "perform_registry_check", side_effect=withdraw_verification),
            self.assertRaises(IssuerIdentityVerificationRequiredException),
        ):
            self.transition("activate")
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.APPROVED)

    def test_the_switch_off_leaves_submission_and_activation_unchanged(self):
        self.require(False)
        self.assertEqual(self.transition("submit", submitted_by=self.owner).status, CompanyStatus.SUBMITTED)
        self.set_status(CompanyStatus.APPROVED)
        self.assertEqual(self.transition("activate").status, CompanyStatus.ACTIVE)

    def test_the_api_names_the_refusal(self):
        self.require(True)
        for document_type in LISTING_REQUIRED_DOCUMENTS:
            CompanyDocument.objects.create(
                company=self.company,
                document_type=document_type,
                name=document_type.label,
                external_url="https://files.example.test/doc",
                file_size=10,
                mime_type="application/pdf",
            )
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.post(f"/api/v1/companies/{self.company.pk}/submit/", {"confirm": True}, format="json")
        self.assertEqual((response.status_code, response.data["code"]), (400, "issuer_identity_verification_required"))
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.DRAFT)

    def test_the_admin_tells_staff_the_owner_must_be_verified_first(self):
        self.require(True)
        self.set_status(CompanyStatus.APPROVED)
        self.client.force_login(self.operator)
        change = reverse("admin:companies_company_change", args=[self.company.pk])
        response = self.client.post(
            reverse("admin:companies_company_transition", args=[self.company.uuid, "activate"]),
            {"confirm": True, **DECLARATION},
        )
        self.assertRedirects(response, change, fetch_redirect_response=False)
        self.assertEqual(
            [str(message) for message in self.client.get(change).context["messages"]],
            [
                "The company owner's identity must be verified first. The operator requires this before a company "
                "is submitted for review or activated."
            ],
        )
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.APPROVED)
