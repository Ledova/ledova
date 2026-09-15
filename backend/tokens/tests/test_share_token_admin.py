import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse

from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from companies.models import Company, CompanyStatus
from shared.tests.tenants import make_tenant
from tokens.models import PauseChange, ShareTokenStatus
from tokens.services import deployment

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=TEST_STORAGES)
class ShareTokenAdminDeployTest(TestCase):
    def setUp(self):
        self.client.force_login(User.objects.create_superuser(email="admin@example.test", password="pw-12345678"))
        self.tenant = make_tenant("owner")
        self.change_url = reverse("admin:tokens_sharetoken_change", args=[self.tenant.token.pk])
        self.deploy_url = reverse("admin:tokens_sharetoken_deploy", args=[self.tenant.token.uuid])

    @patch("tokens.tasks.deploy_share_token_task")
    def test_confirm_page_and_post_start_the_deployment(self, deploy_task):
        Company.objects.filter(pk=self.tenant.company.pk).update(status=CompanyStatus.ACTIVE)

        confirm = self.client.get(self.deploy_url)
        self.assertEqual(confirm.status_code, 200)
        self.assertEqual(confirm.context["primary_wallet"], self.tenant.wallet)

        started = self.client.post(self.deploy_url)
        self.assertRedirects(started, self.change_url, fetch_redirect_response=False)
        self.assertContains(self.client.get(self.change_url), "Deployment started for")
        self.tenant.token.refresh_from_db()
        self.assertEqual(self.tenant.token.status, ShareTokenStatus.DEPLOYING)
        deploy_task.defer.assert_called_once_with(
            token_uuid=str(self.tenant.token.uuid),
            deployment_id=str(self.tenant.token.deployment_id),
            principal_id=None,
        )

    @patch("tokens.tasks.deploy_share_token_task")
    def test_readiness_guards_redirect_with_the_reason(self, deploy_task):
        for method in (self.client.get, self.client.post):
            response = method(self.deploy_url)
            self.assertRedirects(response, self.change_url, fetch_redirect_response=False)
            change_page = self.client.get(self.change_url)
            self.assertContains(change_page, "Cannot deploy: Company must be active before deploying tokens.")
            self.assertContains(change_page, "⚠ Company must be active before deploying tokens.")

        self.tenant.token.refresh_from_db()
        self.assertEqual(self.tenant.token.status, ShareTokenStatus.DRAFT)
        deploy_task.defer.assert_not_called()

    @patch("tokens.tasks.deploy_share_token_task")
    def test_retry_deployment_requeues_the_task_for_a_deploying_token_only(self, deploy_task):
        token = self.tenant.token
        retry_url = reverse("admin:tokens_sharetoken_retry_deploy", args=[token.uuid])

        for method in (self.client.get, self.client.post):
            refused = method(retry_url)
            self.assertRedirects(refused, self.change_url, fetch_redirect_response=False)
            self.assertContains(self.client.get(self.change_url), "Cannot retry deployment: Cannot retry deployment")
        deploy_task.defer.assert_not_called()

        Company.objects.filter(pk=token.company_id).update(status=CompanyStatus.ACTIVE)
        deployment.start_deployment(token, principal_id=None)
        deploy_task.defer.reset_mock()
        self.assertContains(self.client.get(self.change_url), retry_url)
        confirm = self.client.get(retry_url)
        self.assertContains(confirm, "Retry Deployment")
        self.assertContains(confirm, 'method="post"')
        deploy_task.defer.assert_not_called()

        retried = self.client.post(retry_url, {"confirmation": confirm.context["confirmation"]})
        self.assertRedirects(retried, self.change_url, fetch_redirect_response=False)
        self.assertContains(self.client.get(self.change_url), "Deployment recovery queued for")
        deploy_task.defer.assert_called_once_with(
            token_uuid=str(token.uuid), deployment_id=str(token.deployment_id), principal_id=None, retry_of=None
        )
        token.refresh_from_db()
        self.assertEqual(token.status, ShareTokenStatus.DEPLOYING)


@override_settings(STORAGES=TEST_STORAGES, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ShareTokenAdminPauseTest(TransactionTestCase):
    def setUp(self):
        self.client.force_login(User.objects.create_superuser(email="admin@example.test", password="pw-12345678"))
        self.chain = patch("tokens.services.share_token_service.get_base_chain_client").start().return_value
        self.addCleanup(patch.stopall)
        self.chain.send_transaction.return_value = ("0xtx", {"blockNumber": 1, "gasUsed": 1})
        self.tenant = make_tenant("owner")
        self.token = self.tenant.deployed_token
        self.change_url = reverse("admin:tokens_sharetoken_change", args=[self.token.pk])
        self.unpause_url = reverse("admin:tokens_sharetoken_unpause", args=[self.token.uuid])
        self.pause_url = reverse("admin:tokens_sharetoken_pause", args=[self.token.uuid])

    def _contract(self):
        return self.chain.load_contract.return_value

    def _chain_paused(self, value):
        self._contract().functions.paused.return_value.call.return_value = value

    def test_deployed_token_the_chain_reports_paused_retains_an_unpause_submission(self):
        self._chain_paused(True)
        change_page = self.client.get(self.change_url)
        self.assertContains(change_page, self.unpause_url)
        self.assertNotContains(change_page, self.pause_url)

        confirm = self.client.get(self.unpause_url)
        self.assertEqual(confirm.status_code, 200)
        self.assertTemplateUsed(confirm, "admin/tokens/sharetoken/pause_confirm.html")
        self.assertContains(confirm, 'method="post"')
        self.assertContains(confirm, "Unpause Token")
        self.chain.send_transaction.assert_not_called()

        response = self.client.post(self.unpause_url, {"confirmation": confirm.context["confirmation"]})
        self.assertRedirects(response, self.change_url, fetch_redirect_response=False)
        self.assertContains(self.client.get(self.change_url), "Unpause request retained")
        self.chain.send_transaction.assert_not_called()
        self.assertFalse(PauseChange.objects.get().paused)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)

    def test_deployed_token_offers_the_button_the_chain_calls_for_and_both_when_it_cannot_be_read(self):
        self._chain_paused(False)
        change_page = self.client.get(self.change_url)
        self.assertContains(change_page, self.pause_url)
        self.assertNotContains(change_page, self.unpause_url)

        self._contract().functions.paused.return_value.call.side_effect = RuntimeError("rpc down")
        change_page = self.client.get(self.change_url)
        self.assertContains(change_page, self.pause_url)
        self.assertContains(change_page, self.unpause_url)

        with patch(
            "tokens.admin.share_token.share_token_service.read_paused",
            side_effect=KeyError("SHARE_TOKEN_FACTORY_ADDRESS"),
        ):
            with self.assertLogs("tokens.admin._helpers", "WARNING") as logs:
                change_page = self.client.get(self.change_url)
        self.assertEqual(change_page.status_code, 200)
        self.assertContains(change_page, self.pause_url)
        self.assertContains(change_page, self.unpause_url)
        self.assertIn("could not be read", logs.output[0])

    def test_a_slow_paused_read_is_abandoned_and_both_buttons_offered(self):
        def slow(*args, **kwargs):
            time.sleep(0.5)
            return False

        self._contract().functions.paused.return_value.call.side_effect = slow
        with patch("tokens.admin._helpers.CHAIN_READ_TIMEOUT", 0.05):
            with self.assertLogs("tokens.admin._helpers", "WARNING") as logs:
                started = time.monotonic()
                change_page = self.client.get(self.change_url)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertContains(change_page, self.pause_url)
        self.assertContains(change_page, self.unpause_url)
        self.assertIn("not answered within", logs.output[0])

    def test_pause_confirmation_retains_the_same_submission_on_repeated_post(self):
        self._chain_paused(False)

        confirm = self.client.get(self.pause_url)
        self.assertEqual(confirm.status_code, 200)
        self.assertContains(confirm, "Pause Token")
        self.assertContains(confirm, self.token.contract_address)
        self.chain.send_transaction.assert_not_called()

        response = self.client.post(self.pause_url, {"confirmation": confirm.context["confirmation"]})
        self.assertRedirects(response, self.change_url, fetch_redirect_response=False)
        self.assertContains(self.client.get(self.change_url), "Pause request retained")
        self.chain.send_transaction.assert_not_called()
        self.client.post(self.pause_url, {"confirmation": confirm.context["confirmation"]})
        self.assertEqual(PauseChange.objects.count(), 1)
        self.assertTrue(PauseChange.objects.get().paused)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)

    def test_missing_or_wrong_confirmation_never_admits_and_draft_has_no_confirmation(self):
        confirm = self.client.get(self.pause_url)
        for value in (None, "invalid", confirm.context["confirmation"]):
            data = {} if value is None else {"confirmation": value}
            self.client.post(self.unpause_url, data)
            self.assertContains(self.client.get(self.change_url), "Reload the pause confirmation")
        draft_pause_url = reverse("admin:tokens_sharetoken_pause", args=[self.tenant.token.uuid])
        refused = self.client.get(draft_pause_url)
        self.assertEqual(refused.status_code, 302)
        self.assertFalse(PauseChange.objects.exists())
        self.chain.send_transaction.assert_not_called()
