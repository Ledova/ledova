from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from companies.models import Company, CompanyStatus
from companies.services import transition_company
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from companies.tests.test_registry_verification import PROVIDER, STORAGES
from operators.models import Operator
from shared.db import use_migrate, use_operator
from users.models import UserProfile

User = get_user_model()


@override_settings(STORAGES=STORAGES, ABR_AUTH_GUID="")
class LegacyTechnicalIdentityGateTest(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="gate-owner@example.test", password="pw-12345678", is_active=True, is_email_verified=True
        )
        self.profile = UserProfile.objects.create(user=self.owner, full_name="Gate Owner")
        self.operator = User.objects.create_superuser(
            email="gate-operator@example.test", password="pw-12345678", is_active=True, is_email_verified=True
        )
        with use_migrate():
            self.company = Company.objects.create(owner=self.owner, name="Gate Example Pty Ltd", acn="123456780")
        self.lookup = patch(PROVIDER, return_value=matching_observation(self.company)).start()
        self.addCleanup(patch.stopall)

    def require(self, required):
        operator = Operator.get()
        operator.issuer_kyc_required = required
        operator.save(update_fields=["issuer_kyc_required"])

    def verify(self, verified):
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=verified)

    def set_status(self, status):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status=status)
        self.company.refresh_from_db()

    def test_an_unverified_legacy_owner_does_not_stop_technical_recovery(self):
        self.require(True)
        for predecessor, method in (
            (CompanyStatus.WARNING, "resolve_warning"),
            (CompanyStatus.SUSPENDED, "reinstate"),
            (CompanyStatus.WARNING, "set_active"),
            (CompanyStatus.SUSPENDED, "set_active"),
        ):
            with self.subTest(predecessor=predecessor, method=method):
                self.set_status(predecessor)
                self.assertEqual(
                    transition_company(self.company, method, actor=self.operator, declaration=DECLARATION).status,
                    CompanyStatus.ACTIVE,
                )
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_id_verified)

    def test_verified_owner_and_disabled_identity_switch_do_not_restore_staff_initial_activation(self):
        for required in (False, True):
            self.require(required)
            self.verify(True)
            for predecessor in (
                CompanyStatus.DRAFT,
                CompanyStatus.SUBMITTED,
                CompanyStatus.REVIEW,
                CompanyStatus.APPROVED,
            ):
                self.set_status(predecessor)
                calls = self.lookup.call_count
                with self.assertRaises(PermissionDenied):
                    transition_company(self.company, "activate", actor=self.operator, declaration=DECLARATION)
                self.company.refresh_from_db()
                self.assertEqual((self.company.status, self.lookup.call_count), (predecessor, calls))

    def test_staff_initial_activation_is_refused_by_api_and_admin(self):
        self.require(False)
        self.verify(True)
        self.set_status(CompanyStatus.APPROVED)
        client = APIClient()
        client.force_authenticate(self.operator)
        response = client.post(
            f"/api/v1/companies/{self.company.pk}/status/", {"status": "active", **DECLARATION}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.client.force_login(self.operator)
        with self.assertRaises(NoReverseMatch):
            reverse("admin:companies_company_transition", args=[self.company.pk, "activate"])
        response = self.client.post(
            f"/admin/companies/company/{self.company.pk}/activate/", {"confirm": True, **DECLARATION}
        )
        self.assertIn(response.status_code, (302, 404))
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.APPROVED)
        self.lookup.assert_not_called()
