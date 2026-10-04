from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import TestCase
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITestCase

from companies.models import Company, CompanyStatus
from companies.services import transition_company
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from shared.db import use_migrate
from users.models import Notification
from users.tasks.notifications import send_push_notification

User = get_user_model()
RETIRED = ("submit", "resubmit", "start_review", "request_info", "approve", "reject", "activate", "withdraw")
TECHNICAL = (
    ("issue_warning", CompanyStatus.ACTIVE, {"reason": "Late filing"}),
    ("resolve_warning", CompanyStatus.WARNING, {}),
    ("suspend", CompanyStatus.ACTIVE, {"reason": "Investigation"}),
    ("reinstate", CompanyStatus.SUSPENDED, {}),
    ("delist", CompanyStatus.ACTIVE, {"reason": "Wound up"}),
)


class RetiredApplicationNotificationTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.test", password="pw-12345678", is_active=True, is_email_verified=True
        )
        self.reviewer = User.objects.create_user(
            email="reviewer@example.test", is_staff=True, is_active=True, is_email_verified=True
        )
        self.bystander = User.objects.create_user(email="bystander@example.test", is_active=True)
        with use_migrate():
            self.company = Company.objects.create(owner=self.owner, name="Acme Pty Ltd", acn="123456780")
        patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)).start()
        self.queue = patch.object(send_push_notification, "defer").start()
        self.addCleanup(patch.stopall)

    def set_status(self, status):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status=status)
        self.company.refresh_from_db()

    def test_retired_instruction_services_cannot_create_notifications_or_effects(self):
        for method in RETIRED:
            for actor in (self.owner, self.reviewer):
                with self.subTest(method=method, actor=actor.pk):
                    with self.assertRaises(PermissionDenied):
                        transition_company(self.company, method, actor=actor, declaration=DECLARATION)
        self.queue.assert_not_called()
        self.assertFalse(Notification.objects.exists())
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.DRAFT)

    def test_technical_transitions_do_not_reintroduce_staff_application_notifications(self):
        for method, status, kwargs in TECHNICAL:
            with self.subTest(method=method):
                self.set_status(status)
                self.company = transition_company(
                    self.company, method, actor=self.reviewer, declaration=DECLARATION, **kwargs
                )
        self.queue.assert_not_called()
        self.assertFalse(Notification.objects.exists())

    def test_retained_historical_notifications_survive_a_refused_staff_instruction(self):
        history = Notification.objects.create(
            user=self.owner,
            notification_type="general",
            title="Application approved",
            body="Acme Pty Ltd has been approved.",
            data={"type": "company", "event": "approve", "company_id": str(self.company.pk), "status": "approved"},
        )
        before = (history.pk, history.title, history.body, history.data, history.created_at)
        with self.assertRaises(PermissionDenied):
            transition_company(self.company, "approve", actor=self.reviewer, declaration=DECLARATION)
        history.refresh_from_db()
        self.assertEqual((history.pk, history.title, history.body, history.data, history.created_at), before)
        self.assertFalse(Notification.objects.filter(user=self.bystander).exists())
        self.queue.assert_not_called()

    def test_failure_after_technical_action_rolls_back_status_and_creates_no_job(self):
        self.set_status(CompanyStatus.ACTIVE)
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                transition_company(self.company, "issue_warning", actor=self.reviewer, reason="Late filing")
                raise RuntimeError("after the technical action")
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
        self.assertIsNone(self.company.warning_issued_at)
        self.queue.assert_not_called()


class RetiredApplicationNotificationRouteTest(APITestCase):
    def test_removed_owner_routes_do_not_emit_notifications(self):
        owner = User.objects.create_user(email="retired-owner@example.test", is_active=True, is_email_verified=True)
        with use_migrate():
            company = Company.objects.create(
                owner=owner, name="Retained company", acn="123456780", status=CompanyStatus.SUBMITTED
            )
        self.client.force_authenticate(owner)
        with patch.object(send_push_notification, "defer") as queue:
            for route, payload in (("submit", {"confirm": True}), ("resubmit", {"response": "Done"}), ("withdraw", {})):
                self.assertEqual(
                    self.client.post(f"/api/v1/companies/{company.pk}/{route}/", payload, format="json").status_code,
                    404,
                )
        queue.assert_not_called()
        self.assertFalse(Notification.objects.exists())
        company.refresh_from_db()
        self.assertEqual(company.status, CompanyStatus.SUBMITTED)
