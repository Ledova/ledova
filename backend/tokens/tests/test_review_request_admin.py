from unittest.mock import patch

from django.contrib.admin.sites import site
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError
from django.test import RequestFactory, TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse
from django.utils import timezone

from shared.db import atomic
from shared.tests.tenants import make_tenant
from tokens.models import CapitalIncreaseRequest, RequestStatus, ShareIssuanceRequest
from tokens.services import capital_execution, issuance_execution
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit, install_capital
from tokens.tests.issuance_fixtures import FINALITY_POLICIES

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def url(obj, action):
    args = {"changelist": [], "change": [obj.pk]}.get(action, [obj.uuid])
    return reverse(f"admin:tokens_{obj._meta.model_name}_{action}", args=args)


@override_settings(
    STORAGES=TEST_STORAGES,
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES,
)
class ReviewRequestAdminTest(TransactionTestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(email="admin@example.test", password="pw-12345678")
        self.client.force_login(self.admin)
        install_capital(self)
        self.capital_increase = self.request
        self.issuance = ShareIssuanceRequest.objects.create(
            token=self.token,
            recipient_address="0x" + "a" * 40,
            recipient_name="Alice",
            amount=10,
            reason="Bonus",
            submitted_by=self.owner,
            submitted_at=timezone.now(),
        )
        self.requests = (self.capital_increase, self.issuance)

    def execution_data(self, obj):
        page = self.client.get(url(obj, "execute"))
        self.assertEqual(page.status_code, 200)
        return {"confirmation": page.context["form"]["confirmation"].value()}

    def assert_deferred(self, task, obj, actor):
        expected = dict(model_label=obj._meta.label, request_uuid=str(obj.pk), executed_by=actor.pk)
        expected["execution_id"] = str(obj.dispatch_id)
        task.assert_called_once_with(**expected)

    def test_execution_requires_active_staff_with_change_permission(self):
        command = admit(self.capital_increase, self.actor)
        staff = User.objects.create_user(
            email="review-staff@example.test", password="pw", is_staff=True, is_active=True
        )
        nonstaff = make_tenant("owner-only").user
        for obj in self.requests:
            with self.subTest(model=obj._meta.model_name), patch(
                "tokens.services.capital_execution.App"
            ) as queue, patch("tokens.services.issuance_execution.App") as issuance_queue:
                for user, status in ((None, 302), (nonstaff, 302), (staff, 403)):
                    self.client.logout()
                    if user is not None:
                        self.client.force_login(user)
                    response = self.client.post(url(obj, "execute"))
                    self.assertEqual(response.status_code, status)
                    if status == 302:
                        self.assertIn(reverse("admin:login"), response.url)
                    queue.assert_not_called()
                    issuance_queue.assert_not_called()
                staff.user_permissions.add(Permission.objects.get(codename=f"change_{obj._meta.model_name}"))
                if isinstance(obj, CapitalIncreaseRequest):
                    response = self.client.post(url(obj, "execute"), self.execution_data(obj))
                    self.assertRedirects(response, url(obj, "change"), fetch_redirect_response=False)
                    queue.assert_not_called()
                    self.assertEqual(capital_execution.recover(command.pk)["status"], "executed")
                else:
                    response = self.client.post(url(obj, "execute"))
                    self.assertRedirects(response, url(obj, "change"), fetch_redirect_response=False)
                    self.assertContains(self.client.get(url(obj, "change")), "current company decision")
                    issuance_queue.assert_not_called()

    def test_capital_pages_retire_staff_review_buttons_and_keep_company_history(self):
        for obj in self.requests:
            self.assertEqual(self.client.get(url(obj, "changelist")).status_code, 200)
            self.assertEqual(self.client.get(url(obj, "change")).status_code, 200)
        capital = self.client.get(url(self.capital_increase, "change"))
        self.assertContains(capital, "Company capital instruction required")
        self.assertNotContains(capital, url(self.capital_increase, "execute"))
        for action in ("start_review", "approve", "reject"):
            with self.subTest(action=action), self.assertRaises(NoReverseMatch):
                url(self.capital_increase, action)
        issuance = self.client.get(url(self.issuance, "change"))
        self.assertContains(issuance, url(self.issuance, "start_review"))
        self.assertContains(issuance, url(self.issuance, "reject"))
        self.assertContains(issuance, "Awaiting a register instruction")
        with self.assertRaises(NoReverseMatch):
            url(self.issuance, "approve")

    def test_company_apply_then_technical_execution_retains_one_original_admission(self):
        with self.assertRaises(DatabaseError), atomic():
            self.capital_increase.approve(self.admin)
        command = admit(self.capital_increase, self.actor)
        self.capital_increase.refresh_from_db()
        self.assertEqual(self.capital_increase.reviewed_by_id, self.owner.pk)
        self.assertContains(self.client.get(url(self.capital_increase, "execute")), "setAuthorizedShares(1100)")
        with patch("tokens.services.capital_execution.App") as queue:
            response = self.client.post(
                url(self.capital_increase, "execute"), self.execution_data(self.capital_increase)
            )
        self.assertRedirects(response, url(self.capital_increase, "change"), fetch_redirect_response=False)
        queue.assert_not_called()
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executed")
        self.assertEqual(self.attempts.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertContains(self.client.get(url(self.capital_increase, "change")), "Executed")

    def test_company_rejection_needs_a_reason_and_staff_keeps_only_issuance_rejection(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            self.company_capital.capital_decide(self.proposal, "reject", reason="")
        self.capital_increase.refresh_from_db()
        self.assertEqual(self.capital_increase.status, RequestStatus.UNDER_REVIEW)
        self.company_capital.capital_decide(self.proposal, "reject", reason="Not this quarter")
        self.capital_increase.refresh_from_db()
        self.assertEqual(
            (self.capital_increase.status, self.capital_increase.rejection_reason),
            (RequestStatus.REJECTED, "Not this quarter"),
        )
        invalid = self.client.post(url(self.issuance, "reject"), {"reason": ""})
        self.assertContains(invalid, "This field is required.")
        response = self.client.post(url(self.issuance, "reject"), {"reason": "Not this quarter"})
        self.assertRedirects(response, url(self.issuance, "change"), fetch_redirect_response=False)
        self.issuance.refresh_from_db()
        self.assertEqual(
            (self.issuance.status, self.issuance.rejection_reason), (RequestStatus.REJECTED, "Not this quarter")
        )

    def test_failed_original_capital_requests_offer_only_an_exact_technical_retry(self):
        command = admit(self.capital_increase, self.actor)
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation refusal")
        self.assertEqual(capital_execution.recover(command.pk)["status"], "failed")
        change = self.client.get(url(self.capital_increase, "change"))
        self.assertContains(change, "Retry Execute")
        self.assertContains(change, url(self.capital_increase, "execute"))
        self.node.client.estimate_gas.side_effect = None
        form = self.execution_data(self.capital_increase)
        with patch("tokens.services.capital_execution.App") as queue, patch(
            "tokens.services.capital_execution._enqueue", self.company_capital.enqueue
        ):
            response = self.client.post(url(self.capital_increase, "execute"), form)
        self.assertRedirects(response, url(self.capital_increase, "change"), fetch_redirect_response=False)
        from tokens.tasks import execute_review_request_task

        queue.return_value.configure_task.assert_called_once_with(execute_review_request_task.name)
        self.assert_deferred(queue.return_value.configure_task.return_value.defer, self.capital_increase, self.owner)
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executed")
        self.assertEqual(self.attempts.count(), 1)

    def test_requests_are_deletable_only_in_their_initial_status(self):
        request = RequestFactory().get("/")
        request.user = self.admin
        capital_admin = site._registry[CapitalIncreaseRequest]
        issuance_admin = site._registry[ShareIssuanceRequest]

        self.assertFalse(capital_admin.has_delete_permission(request, self.capital_increase))
        self.assertTrue(issuance_admin.has_delete_permission(request, self.issuance))
        self.assertFalse(capital_admin.has_add_permission(request))

        with self.assertRaises(DatabaseError), atomic():
            CapitalIncreaseRequest.objects.filter(pk=self.capital_increase.pk).update(status=RequestStatus.DRAFT)
        draft = CapitalIncreaseRequest.objects.create(
            token=self.tenant.deployed_token,
            additional_shares=5,
            new_authorized_total=1005,
            purpose="Draft deletion control",
            board_resolution_reference="DRAFT-BOARD",
        )
        with self.assertRaises(DatabaseError), atomic():
            self.issuance.approve(self.admin)
        self.issuance.refresh_from_db()
        self.assertTrue(capital_admin.has_delete_permission(request, draft))
        self.assertTrue(issuance_admin.has_delete_permission(request, self.issuance))


class CompanyIssueAdminRecoveryTest(TransactionTestCase):
    def setUp(self):
        from tokens.tests.issuance_fixtures import install_issuance

        install_issuance(self)
        self.client.force_login(self.actor)

    def test_company_admission_retains_its_actor_and_is_recoverable_by_the_technical_admin(self):
        from tokens.tests.issuance_fixtures import admit

        command = admit(self.request, self.actor)
        self.request.refresh_from_db()
        page = self.client.get(url(self.request, "execute"))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, f"mint({self.request.recipient_address}, {self.request.amount})")
        confirmation = page.context["form"]["confirmation"].value()
        with patch("tokens.services.issuance_execution.App") as queue:
            response = self.client.post(url(self.request, "execute"), {"confirmation": confirmation})
        self.assertRedirects(response, url(self.request, "change"), fetch_redirect_response=False)
        from tokens.tasks import execute_review_request_task

        queue.return_value.configure_task.assert_called_once_with(execute_review_request_task.name)
        queue.return_value.configure_task.return_value.defer.assert_called_once_with(
            model_label=self.request._meta.label,
            request_uuid=str(self.request.pk),
            executed_by=self.actor.pk,
            execution_id=str(command.pk),
        )
        admin_request = RequestFactory().get("/")
        admin_request.user = self.actor
        self.assertFalse(site._registry[ShareIssuanceRequest].has_delete_permission(admin_request, self.request))
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_finalized_company_revert_offers_only_an_explicit_original_claim_retry(self):
        from tokens.tests.issuance_fixtures import admit

        command = admit(self.request, self.actor)
        self.node.receipt_status = 0
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "failed")
        self.assertContains(self.client.get(url(self.request, "change")), "Retry Execute")
        page = self.client.get(url(self.request, "execute"))
        confirmation = page.context["form"]["confirmation"].value()
        self.node.receipt_status = 1
        with patch("tokens.services.issuance_execution.App"):
            response = self.client.post(url(self.request, "execute"), {"confirmation": confirmation})
        self.assertRedirects(response, url(self.request, "change"), fetch_redirect_response=False)
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executed")
        self.assertEqual(self.attempts.count(), 2)
        self.assertEqual(self.transactions.filter(status="reverted").count(), 1)
