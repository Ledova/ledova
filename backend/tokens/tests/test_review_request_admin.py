from datetime import timedelta
from unittest.mock import patch

from django.contrib.admin.sites import site
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError
from django.test import RequestFactory, TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse
from django.utils import timezone
from eth_abi import encode
from web3 import Web3

from blockchain.tests.outgoing_fixtures import admitted_signer, chain_client
from shared.db import atomic
from shared.tests.tenants import make_tenant
from tokens.models import (
    CapitalIncreaseRequest,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.services import capital_execution, issuance_execution, share_token_service
from tokens.services.capital_increase import submit_capital_increase
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, CapitalNode
from tokens.tests.instruction_fixtures import apply_instruction
from tokens.tests.issuance_fixtures import FINALITY_POLICIES, IssuanceNode

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
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
        self.tenant = make_tenant("owner")
        self.capital_increase = self.tenant.capital_increase
        submit_capital_increase(self.capital_increase, self.tenant.user)
        self.issuance = ShareIssuanceRequest.objects.create(
            token=self.tenant.deployed_token,
            recipient_address="0x" + "a" * 40,
            recipient_name="Alice",
            amount=10,
            reason="Bonus",
            submitted_by=self.tenant.user,
            submitted_at=timezone.now(),
        )
        self.requests = (self.capital_increase, self.issuance)
        self.node = CapitalNode()
        self.issuance_node = IssuanceNode()
        self.enterContext(
            patch("tokens.services.issuance_execution.get_base_chain_client", return_value=self.issuance_node.client)
        )
        self.enterContext(patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=True))
        admitted_signer()
        patcher = patch("tokens.services.capital_execution.get_base_chain_client", return_value=self.node.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def execution_data(self, obj):
        page = self.client.get(url(obj, "execute"))
        self.assertEqual(page.status_code, 200)
        return {"confirmation": page.context["form"]["confirmation"].value()}

    def assert_deferred(self, task, obj, actor):
        expected = dict(model_label=obj._meta.label, request_uuid=str(obj.pk), executed_by=actor.pk)
        expected["execution_id"] = str(obj.dispatch_id)
        task.assert_called_once_with(**expected)

    def test_execution_requires_active_staff_with_change_permission(self):
        staff = User.objects.create_user(
            email="review-staff@example.test", password="pw", is_staff=True, is_active=True
        )
        for obj in self.requests:
            obj.approve(self.admin)
            with self.subTest(model=obj._meta.model_name), patch(
                "tokens.tasks.execute_review_request_task.defer"
            ) as task:
                for user, status in ((None, 302), (self.tenant.user, 302), (staff, 403)):
                    self.client.logout()
                    if user is not None:
                        self.client.force_login(user)
                    response = self.client.post(url(obj, "execute"))
                    self.assertEqual(response.status_code, status)
                    if status == 302:
                        self.assertIn(reverse("admin:login"), response.url)
                    task.assert_not_called()
                staff.user_permissions.add(Permission.objects.get(codename=f"change_{obj._meta.model_name}"))
                response = self.client.post(url(obj, "execute"), self.execution_data(obj))
                self.assertRedirects(response, url(obj, "change"), fetch_redirect_response=False)
                self.assert_deferred(task, obj, staff)

    def test_changelist_and_change_pages_render_with_the_review_buttons(self):
        for obj in self.requests:
            with self.subTest(model=obj._meta.model_name):
                self.assertEqual(self.client.get(url(obj, "changelist")).status_code, 200)
                change = self.client.get(url(obj, "change"))
                self.assertEqual(change.status_code, 200)
                self.assertContains(change, url(obj, "start_review"))
                self.assertContains(change, url(obj, "reject"))
                self.assertNotContains(change, url(obj, "execute"))
        self.assertContains(
            self.client.get(url(self.capital_increase, "change")), url(self.capital_increase, "approve")
        )
        self.assertContains(self.client.get(url(self.issuance, "change")), "Awaiting a register instruction")
        with self.assertRaises(NoReverseMatch):
            url(self.issuance, "approve")

    def test_legacy_recovery_renders_the_hash_form_without_a_release_action(self):
        self.issuance = ShareIssuanceRequest.objects.create(
            token=self.tenant.deployed_token,
            recipient_address=self.issuance.recipient_address,
            amount=10,
            status=RequestStatus.FAILED,
            dispatch_id=None,
        )
        ShareIssuanceRequest.objects.filter(pk=self.issuance.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        recorded = ShareIssuance.objects.create(
            token=self.issuance.token,
            recipient_address=self.issuance.recipient_address,
            amount=str(self.issuance.amount),
            status="failed",
            idempotency_key=share_token_service.issuance_key(self.issuance),
            processed_at=timezone.now() - timedelta(hours=1),
        )
        change = self.client.get(url(self.issuance, "change"))
        self.assertContains(change, "Record legacy transaction hash")
        self.assertNotContains(change, "Release claim")
        with self.assertRaises(NoReverseMatch):
            url(self.issuance, "release_claim")

        page = self.client.get(url(self.issuance, "name_mint"))
        self.assertContains(page, 'name="tx_hash"')
        invalid = self.client.post(url(self.issuance, "name_mint"), {"tx_hash": "0x" + "z" * 64})
        self.assertContains(invalid, "64 hexadecimal characters")
        recorded.refresh_from_db()
        self.assertIsNone(recorded.tx_hash)
        historical_client = chain_client()
        historical_client.get_transaction.return_value = {
            "hash": "0x" + "ab" * 32,
            "to": self.issuance.token.contract_address,
            "value": 0,
            "input": Web3.keccak(text="mint(address,uint256)")[:4]
            + encode(["address", "uint256"], [self.issuance.recipient_address, 10]),
        }
        with patch("tokens.services.legacy_issuance.get_base_chain_client", return_value=historical_client):
            response = self.client.post(url(self.issuance, "name_mint"), {"tx_hash": "0x" + "ab" * 32})
        self.assertRedirects(response, url(self.issuance, "change"), fetch_redirect_response=False)
        recorded.refresh_from_db()
        self.assertEqual(recorded.tx_hash, "0x" + "ab" * 32)

    def test_start_review_approve_then_execute_defers_one_task(self):
        for obj, step in ((self.capital_increase, "setAuthorizedShares(1100)"), (self.issuance, "mint(0x")):
            with self.subTest(model=obj._meta.model_name):
                started = self.client.get(url(obj, "start_review"))
                self.assertRedirects(started, url(obj, "change"), fetch_redirect_response=False)
                obj.refresh_from_db()
                self.assertEqual((obj.status, obj.reviewed_by), (RequestStatus.UNDER_REVIEW, self.admin))
                self.assertContains(self.client.get(url(obj, "change")), "Review started for")

                if isinstance(obj, CapitalIncreaseRequest):
                    page = self.client.get(url(obj, "approve"))
                    self.assertContains(page, "Approve Request")
                    self.assertContains(page, obj.token.symbol)
                    approved = self.client.post(url(obj, "approve"), {"notes": "Looks fine"})
                    self.assertRedirects(approved, url(obj, "change"), fetch_redirect_response=False)
                    notes, shown = "Looks fine", "Ready for execution"
                else:
                    instruction = apply_instruction(obj.token, obj, reviewer=self.admin)
                    notes, shown = f"Approved by register instruction {instruction.pk}.", "Approved"
                obj.refresh_from_db()
                self.assertEqual(
                    (obj.status, obj.reviewed_by, obj.review_notes), (RequestStatus.APPROVED, self.admin, notes)
                )
                change = self.client.get(url(obj, "change"))
                self.assertContains(change, shown)
                self.assertContains(change, url(obj, "execute"))

                self.assertContains(self.client.get(url(obj, "execute")), step)
                with patch("tokens.tasks.execute_review_request_task.defer") as task:
                    executed = self.client.post(url(obj, "execute"), self.execution_data(obj))
                self.assertRedirects(executed, url(obj, "change"), fetch_redirect_response=False)
                self.assert_deferred(task, obj, self.admin)
                expected = (
                    "Capital increase status: Executing"
                    if isinstance(obj, CapitalIncreaseRequest)
                    else "Issuance status: Approved"
                )
                self.assertContains(self.client.get(url(obj, "change")), expected)

    def test_reject_needs_a_reason_and_closes_the_request(self):
        for obj in self.requests:
            with self.subTest(model=obj._meta.model_name):
                invalid = self.client.post(url(obj, "reject"), {"reason": ""})
                self.assertContains(invalid, "This field is required.")
                obj.refresh_from_db()
                self.assertEqual(obj.status, RequestStatus.SUBMITTED)

                rejected = self.client.post(url(obj, "reject"), {"reason": "Not this quarter"})
                self.assertRedirects(rejected, url(obj, "change"), fetch_redirect_response=False)
                obj.refresh_from_db()
                self.assertEqual((obj.status, obj.rejection_reason), (RequestStatus.REJECTED, "Not this quarter"))
                self.assertContains(self.client.get(url(obj, "change")), "Request Rejected")

        self.client.get(url(self.capital_increase, "approve"))
        self.assertContains(
            self.client.get(url(self.capital_increase, "change")),
            "Cannot approve: request status is &#x27;Rejected&#x27;",
        )

    def test_state_guards_redirect_and_failed_requests_offer_a_retry(self):
        draft = CapitalIncreaseRequest.objects.create(
            token=self.tenant.deployed_token,
            additional_shares=5,
            new_authorized_total=1005,
            purpose="Later",
            board_resolution_reference="BOARD-2",
        )
        self.client.get(url(draft, "start_review"))
        self.assertContains(
            self.client.get(url(draft, "change")), "Cannot start review: request status is &#x27;Draft&#x27;"
        )
        self.assertContains(self.client.get(url(draft, "change")), "Awaiting Submission")

        for obj in self.requests:
            with self.subTest(model=obj._meta.model_name):
                refused = self.client.post(url(obj, "execute"))
                self.assertRedirects(refused, url(obj, "change"), fetch_redirect_response=False)
                self.assertContains(
                    self.client.get(url(obj, "change")), "Cannot execute: request status is &#x27;Submitted&#x27;"
                )

                if isinstance(obj, CapitalIncreaseRequest):
                    obj.approve(self.admin)
                    self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation refusal")
                    with patch("tokens.tasks.execute_review_request_task.defer"):
                        command = capital_execution.admit(
                            obj, self.admin, confirmed=capital_execution.confirmation(obj, self.admin)
                        )
                    capital_execution.recover(command.pk)
                else:
                    obj.approve(self.admin)
                    self.issuance_node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation refusal")
                    with patch("tokens.tasks.execute_review_request_task.defer"):
                        command = issuance_execution.admit(
                            obj, self.admin, confirmed=issuance_execution.confirmation(obj, self.admin)
                        )
                    issuance_execution.recover(command.pk)
                change = self.client.get(url(obj, "change"))
                self.assertContains(change, "Retry Execute")
                self.assertContains(change, url(obj, "execute"))
                self.assertEqual(self.client.get(url(obj, "execute")).status_code, 200)

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
        self.issuance.approve(self.admin)
        self.assertTrue(capital_admin.has_delete_permission(request, draft))
        self.assertFalse(issuance_admin.has_delete_permission(request, self.issuance))
