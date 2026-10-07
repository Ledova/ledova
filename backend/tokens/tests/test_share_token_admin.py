from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse

from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from companies.models import Company, CompanyStatus
from shared.tests.tenants import make_tenant
from tokens.models import PauseChange, ShareTokenStatus
from tokens.tests.deployment_fixtures import FACTORY, admit_deployment

User = get_user_model()

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(
    STORAGES=TEST_STORAGES,
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
)
class ShareTokenAdminDeployTest(TransactionTestCase):
    def setUp(self):
        from tokens.tasks import deploy_share_token_task

        self.deployment_task_name = deploy_share_token_task.name
        self.client.force_login(User.objects.create_superuser(email="admin@example.test", password="pw-12345678"))
        self.tenant = make_tenant("owner")
        self.change_url = reverse("admin:tokens_sharetoken_change", args=[self.tenant.token.pk])
        self.deploy_url = f"/admin/tokens/sharetoken/{self.tenant.token.pk}/deploy/"

    @patch("tokens.tasks.deploy_share_token_task")
    def test_routine_staff_deployment_admission_is_retired(self, deploy_task):
        change_page = self.client.get(self.change_url)
        self.assertNotContains(change_page, "Deploy Token")
        for method in (self.client.get, self.client.post):
            response = method(self.deploy_url)
            self.assertIn(response.status_code, (302, 404))
        self.tenant.token.refresh_from_db()
        self.assertEqual(self.tenant.token.status, ShareTokenStatus.DRAFT)
        self.assertIsNone(self.tenant.token.deployment_id)
        deploy_task.defer.assert_not_called()

    @patch("tokens.tasks.deploy_share_token_task")
    def test_retry_deployment_requeues_the_task_for_a_deploying_token_only(self, deploy_task):
        deploy_task.name = self.deployment_task_name
        token = self.tenant.token
        retry_url = reverse("admin:tokens_sharetoken_retry_deploy", args=[token.uuid])

        for method in (self.client.get, self.client.post):
            refused = method(retry_url)
            self.assertRedirects(refused, self.change_url, fetch_redirect_response=False)
            self.assertContains(self.client.get(self.change_url), "Cannot retry deployment: Cannot retry deployment")
        deploy_task.defer.assert_not_called()

        Company.objects.filter(pk=token.company_id).update(status=CompanyStatus.ACTIVE)
        admit_deployment(token, self.tenant.user)
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
        self.administrator = User.objects.create_superuser(email="admin@example.test", password="pw-12345678")
        self.client.force_login(self.administrator)
        self.tenant = make_tenant("owner")
        self.token = self.tenant.deployed_token
        self.change_url = reverse("admin:tokens_sharetoken_change", args=[self.token.pk])

    def test_routine_staff_pause_and_unpause_admission_routes_are_retired(self):
        for name in ("tokens_sharetoken_pause", "tokens_sharetoken_unpause"):
            with self.assertRaises(NoReverseMatch):
                reverse(f"admin:{name}", args=[self.token.pk])
        self.assertFalse(PauseChange.objects.exists())

    def test_class_metadata_no_longer_reads_pause_rpc_or_offers_fresh_staff_buttons(self):
        with patch(
            "tokens.services.share_token_service.get_base_chain_client",
            side_effect=AssertionError("No routine pause RPC"),
        ):
            response = self.client.get(self.change_url)
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Pause Token")
        self.assertNotContains(response, "Unpause Token")
        self.assertContains(response, "No pause submission recorded")

    def test_removed_staff_post_does_not_create_a_command_or_confirm_unsigned_history(self):
        for direction in ("pause", "unpause"):
            response = self.client.post(
                f"/admin/tokens/sharetoken/{self.token.pk}/{direction}/", {"confirmation": "obsolete"}
            )
            self.assertIn(response.status_code, (302, 404))
        self.assertFalse(PauseChange.objects.exists())

    def test_private_administration_preserves_actual_staff_signed_original_without_admitting_new_work(self):
        from blockchain.tests.outgoing_fixtures import admitted_signer
        from tokens.services import pause_recovery
        from tokens.tests.pause_fixtures import PauseNode
        from tokens.tests.retained_pause_fixtures import retain_pause_change

        admitted_signer()
        change = retain_pause_change(self.token, self.administrator, signed=True, authority="staff")
        node = PauseNode(self.token.contract_address)
        with patch("tokens.services.pause_recovery.get_base_chain_client", return_value=node.client):
            self.assertEqual(pause_recovery.recover(change.pk).status, "confirmed")
        response = self.client.get(self.change_url)
        self.assertContains(response, str(change.pk))
        self.assertContains(response, "original pause transaction was confirmed")
        self.assertEqual(PauseChange.objects.count(), 1)

    def test_draft_metadata_has_no_pause_confirmation_or_fresh_admission(self):
        path = reverse("admin:tokens_sharetoken_change", args=[self.tenant.token.pk])
        response = self.client.get(path)
        self.assertNotContains(response, "Pause Token")
        self.assertNotContains(response, "Unpause Token")
        self.assertFalse(PauseChange.objects.exists())
