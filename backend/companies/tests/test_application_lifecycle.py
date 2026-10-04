from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from companies.exceptions import InvalidStatusTransitionException
from companies.models import Company, CompanyStatus
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from companies.tests.test_document_file_access import admit_company_administrator
from shared.db import use_migrate
from users.models import UserProfile

User = get_user_model()


class ApplicationLifecycleTest(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.test", password="pw-12345678", is_active=True, is_email_verified=True
        )
        self.other = User.objects.create_user(
            email="other@example.test", password="pw-12345678", is_active=True, is_email_verified=True
        )
        self.staff = User.objects.create_user(
            email="staff@example.test", password="pw-12345678", is_staff=True, is_active=True, is_email_verified=True
        )
        with use_migrate():
            self.company = Company.objects.create(owner=self.owner, name="Draft Pty Ltd", acn="123456780")
        admit_company_administrator(self.company)
        patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)).start()
        self.addCleanup(patch.stopall)
        self.url = f"/api/v1/companies/{self.company.uuid}/"

    def set_status(self, new_status, reason="", expect=200):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            f"{self.url}status/", {"status": new_status, "reason": reason, **DECLARATION}, format="json"
        )
        self.assertEqual(response.status_code, expect, response.data)
        self.company.refresh_from_db()
        return response

    def test_register_creates_draft_company_and_primary_contact_profile(self):
        UserProfile.objects.create(
            user=self.other, full_name="Old Name", phone_country_code="+61", phone_number="0400000000"
        )
        self.client.force_authenticate(self.other)
        payload = {
            "name": "New Co Pty Ltd",
            "acn": "987 654 320",
            "companyType": "pty",
            "primaryContact": {"firstName": "Ada", "lastName": "Lovelace", "phone": "+61 0400000000"},
        }
        response = self.client.post("/api/v1/companies/", payload, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn("message", response.data)
        company = Company.objects.get(acn="987654320")
        self.assertEqual(response.data["company"]["uuid"], str(company.uuid))
        self.assertEqual(company.status, CompanyStatus.DRAFT)
        self.assertEqual(company.owner, self.other)
        profile = UserProfile.objects.get(user=self.other)
        self.assertEqual(profile.full_name, "Ada Lovelace")
        self.assertEqual(profile.phone_country_code, "+61")
        self.assertEqual(profile.phone_number, "0400000000")

    def test_register_rejects_duplicate_acn(self):
        self.client.force_authenticate(self.other)
        payload = {"name": "Dup", "acn": self.company.acn, "primaryContact": {"firstName": "A", "lastName": "B"}}
        response = self.client.post("/api/v1/companies/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("acn", response.data)
        self.assertEqual(Company.objects.filter(acn=self.company.acn).count(), 1)

    def test_retired_owner_application_routes_cannot_change_any_historical_state(self):
        for state in CompanyStatus:
            with use_migrate():
                Company.objects.filter(pk=self.company.pk).update(status=state)
            for actor in (self.owner, self.other, self.staff):
                self.client.force_authenticate(actor)
                for action, payload in (
                    ("submit", {"confirm": True}),
                    ("resubmit", {"response": "Uploaded"}),
                    ("withdraw", {"reason": "Changed plans"}),
                ):
                    with self.subTest(state=state, actor=actor.pk, action=action):
                        self.assertEqual(
                            self.client.post(f"{self.url}{action}/", payload, format="json").status_code, 404
                        )
                        self.company.refresh_from_db()
                        self.assertEqual(self.company.status, state)

    def test_staff_cannot_create_normal_review_approval_or_initial_activation(self):
        for target in ("review", "approved", "submitted", "rejected", "info_required", "withdrawn", "bogus"):
            self.set_status(target, reason="x", expect=400)
            self.assertEqual(self.company.status, CompanyStatus.DRAFT)
        self.set_status("active", expect=400)
        self.assertEqual(self.company.status, CompanyStatus.DRAFT)
        self.assertIsNone(self.company.approved_at)
        self.assertIsNone(self.company.activated_at)

    def test_legacy_technical_warning_suspension_and_delisting_remain_available(self):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status=CompanyStatus.ACTIVE)
        self.set_status("warning", reason="Late filing")
        self.assertEqual(self.company.warning_reason, "Late filing")
        self.set_status("active")
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
        self.set_status("suspended", reason="Investigation")
        self.assertEqual(self.company.suspension_reason, "Investigation")
        self.set_status("active")
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
        self.set_status("delisted", reason="Wound up")
        self.assertEqual(self.company.delisting_reason, "Wound up")
        self.assertIsNotNone(self.company.delisted_at)

    def test_invalid_technical_transitions_remain_atomic(self):
        for transition in (
            self.company.resolve_warning,
            self.company.reinstate,
            lambda: self.company.issue_warning("x"),
            lambda: self.company.suspend("x"),
            lambda: self.company.delist("x"),
        ):
            with self.assertRaises(InvalidStatusTransitionException):
                transition()
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.DRAFT)

    def test_non_staff_and_anonymous_cannot_use_technical_routes(self):
        for actor, expected in ((self.owner, 403), (self.other, 403), (None, 401)):
            self.client.force_authenticate(actor)
            self.assertEqual(
                self.client.post(f"{self.url}status/", {"status": "warning", "reason": "x"}, format="json").status_code,
                expected,
            )
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.DRAFT)
