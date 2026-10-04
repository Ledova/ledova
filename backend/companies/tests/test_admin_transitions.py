from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import NoReverseMatch, reverse

from companies.admin.company import STATUS_BUTTONS, TRANSITIONS
from companies.models import Company, CompanyStatus
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from shared.db import use_migrate

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
REASON_FIELDS = ("info_request_reason", "rejection_reason", "warning_reason", "suspension_reason", "delisting_reason")

CASES = [
    ("retry-registry", CompanyStatus.WARNING, CompanyStatus.WARNING),
    ("issue-warning", CompanyStatus.ACTIVE, CompanyStatus.WARNING),
    ("resolve-warning", CompanyStatus.WARNING, CompanyStatus.ACTIVE),
    ("suspend", CompanyStatus.ACTIVE, CompanyStatus.SUSPENDED),
    ("reinstate", CompanyStatus.SUSPENDED, CompanyStatus.ACTIVE),
    ("delist", CompanyStatus.ACTIVE, CompanyStatus.DELISTED),
]


@override_settings(STORAGES=TEST_STORAGES)
class CompanyAdminTransitionTest(TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.admin = User.objects.create_superuser(email="admin-companies@example.test", password="pw-12345678")
        self.client.force_login(self.admin)
        owner = User.objects.create_user(email="owner-companies@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=owner, name="Transit Pty Ltd", acn="111222333")
        patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)).start()
        self.change_url = reverse("admin:companies_company_change", args=[self.company.pk])

    def _url(self, action):
        return reverse("admin:companies_company_transition", args=[self.company.uuid, action])

    def _set_status(self, status):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status=status)
        self.company.refresh_from_db()

    def _follow(self, response):
        self.assertRedirects(response, self.change_url, fetch_redirect_response=False)
        page = self.client.get(self.change_url)
        return [str(message) for message in page.context["messages"]]

    def test_cases_cover_every_declared_transition_and_button(self):
        self.assertEqual({action for action, *_ in CASES}, set(TRANSITIONS))
        offered = {slug for buttons in STATUS_BUTTONS.values() for _, slug, *_ in buttons if slug}
        self.assertEqual(offered, set(TRANSITIONS))
        self.assertEqual(set(STATUS_BUTTONS), set(CompanyStatus))

    def test_each_button_moves_the_company_and_reports_it(self):
        for action, start, end in CASES:
            with self.subTest(action=action):
                self._set_status(start)
                spec = TRANSITIONS[action]
                if "label" in spec:
                    page = self.client.get(self._url(action))
                    self.assertEqual(page.status_code, 200)
                    self.assertTemplateUsed(page, "admin/companies/company/transition_form.html")
                    self.assertContains(page, spec["button"][0])
                    self.assertContains(page, spec["label"])
                    self.assertContains(page, f"(ACN: {self.company.acn})" if "{acn}" in spec["intro"] else "Pty Ltd")
                    response = self.client.post(self._url(action), {"reason": f"because {action}"})
                else:
                    page = self.client.get(self._url(action))
                    self.assertEqual(page.status_code, 200)
                    self.company.refresh_from_db()
                    self.assertEqual(self.company.status, start)
                    response = self.client.post(self._url(action), {"confirm": True, **DECLARATION})

                messages = self._follow(response)
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, end)
                self.assertEqual(messages, [spec["done"].format(name=self.company.name)])
                if "label" in spec:
                    reasons = {getattr(self.company, field) for field in REASON_FIELDS}
                    self.assertIn(f"because {action}", reasons)

    def test_staff_normal_review_routes_are_retired_without_inventing_historical_actors(self):
        for action in ("start-review", "request-info", "approve", "reject", "activate"):
            self._set_status(CompanyStatus.REVIEW)
            with self.assertRaises(NoReverseMatch):
                self._url(action)
            response = self.client.post(
                f"/admin/companies/company/{self.company.pk}/{action}/",
                {"confirm": True, "reason": "no", **DECLARATION},
            )
            self.assertIn(response.status_code, (302, 404))
            self.company.refresh_from_db()
            self.assertEqual(self.company.status, CompanyStatus.REVIEW)
            self.assertIsNone(self.company.approved_by_id)
            self.assertIsNone(self.company.rejected_by_id)

    def test_wrong_state_is_refused_with_the_model_message(self):
        for action, _, _ in CASES:
            with self.subTest(action=action):
                self._set_status(CompanyStatus.DRAFT)
                if "label" in TRANSITIONS[action]:
                    response = self.client.post(self._url(action), {"reason": "x"})
                else:
                    response = self.client.post(self._url(action), {"confirm": True, **DECLARATION})

                (message,) = self._follow(response)
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, CompanyStatus.DRAFT)
                self.assertTrue(message.startswith("Cannot transition from 'Draft' to '"), message)

    def test_blank_technical_reason_re_renders_the_form(self):
        self._set_status(CompanyStatus.ACTIVE)
        response = self.client.post(self._url("issue-warning"), {"reason": ""})
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "admin/companies/company/transition_form.html")
        self.assertContains(response, "This field is required.")
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)

    def test_change_page_offers_the_buttons_for_each_status(self):
        for status, buttons in STATUS_BUTTONS.items():
            with self.subTest(status=status):
                self._set_status(status)
                response = self.client.get(self.change_url)
                self.assertEqual(response.status_code, 200)
                for label, slug, *_ in buttons:
                    self.assertContains(response, label)
                    if slug:
                        self.assertContains(response, self._url(slug))

    def test_change_page_retains_the_historical_applicant_answer(self):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(
                status=CompanyStatus.SUBMITTED,
                info_request_reason="Send the share register",
                additional_info_response="Share register attached as a document",
            )
        response = self.client.get(self.change_url)
        self.assertContains(response, "Send the share register")
        self.assertContains(response, "Share register attached as a document")
        self.assertNotContains(response, "The company will be notified")

    def test_unknown_action_is_not_a_transition_route(self):
        self._set_status(CompanyStatus.REVIEW)

        response = self.client.get(f"/admin/companies/company/{self.company.uuid}/frobnicate/")

        self.assertNotEqual(response.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.REVIEW)
