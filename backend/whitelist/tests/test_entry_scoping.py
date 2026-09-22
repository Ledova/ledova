from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction, SignedAttempt
from shared.tests.tenants import an_account
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.exceptions import WalletNotRegisteredException
from whitelist.models import WhitelistApproval, WhitelistChange, WhitelistEntry
from whitelist.services import whitelist
from whitelist.tests.change_fixtures import (
    CHAIN_ID,
    FACTORY,
    KEY,
    REGISTRY,
    WhitelistNode,
    admitted_signer,
    change_company,
)

User = get_user_model()


@override_settings(BLOCKCHAIN_CHAIN_ID=CHAIN_ID, BLOCKCHAIN_OPERATOR_KEY=KEY, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class WhitelistEntryScopingTest(APITransactionTestCase):
    def setUp(self):
        self.member = User.objects.create_user(email="member-whitelist@ex.com", password="pw-12345678")
        profile = UserProfile.objects.create(user=self.member)
        account = UserAccount.objects.create(user_profile=profile)
        self.wallet = Wallet.objects.create(
            user_account=account,
            address="0x" + "a" * 40,
            chain="base",
        )
        self.entry = WhitelistEntry.objects.create(wallet=self.wallet)
        foreign_account = an_account("entry-scoping")
        self.foreign_wallet = Wallet.objects.create(
            user_account=foreign_account,
            address="0x" + "b" * 40,
            chain="base",
        )
        self.foreign_entry = WhitelistEntry.objects.create(wallet=self.foreign_wallet)
        self.company = change_company("entry-scoping")
        WhitelistApproval.objects.create(
            entry=self.foreign_entry, company=self.company, registry_address=REGISTRY, status="active"
        )
        self.staff = User.objects.create_user(
            email="staff-whitelist@ex.com",
            password="pw-12345678",
            is_staff=True,
            is_active=True,
        )
        self.superuser_only = User.objects.create_user(
            email="superuser-only-whitelist@ex.com",
            password="pw-12345678",
            is_superuser=True,
            is_staff=False,
        )
        self.list_url = "/api/v1/whitelist/"
        self.detail_url = f"{self.list_url}{self.entry.uuid}/"
        self.by_address_url = f"/api/v1/whitelist/entry/{self.wallet.address}/"
        self.export_url = "/api/v1/whitelist/export/"
        self.add_url = "/api/v1/whitelist/add/"
        self.remove_url = "/api/v1/whitelist/remove/"
        self.batch_add_url = "/api/v1/whitelist/batch-add/"
        self.sync_url = f"/api/v1/whitelist/sync/{self.wallet.address}/"

    def terms(self, **extra):
        return {"walletAddress": self.wallet.address, "company": str(self.company.pk), **extra}

    def _operator_route_requests(self):
        return [
            ("get", self.list_url, None),
            ("get", self.detail_url, None),
            ("get", self.by_address_url, None),
            ("get", self.export_url, None),
            ("post", self.add_url, self.terms()),
            ("post", self.remove_url, self.terms()),
            ("post", self.batch_add_url, {"entries": [self.terms()]}),
            ("post", self.sync_url, None),
            ("post", self.list_url, {"status": "active"}),
            ("put", self.detail_url, {"status": "active"}),
            ("patch", self.detail_url, {"status": "active"}),
            ("delete", self.detail_url, None),
        ]

    @patch("whitelist.views.entry.whitelist")
    def test_nonoperators_cannot_use_operator_routes(self, whitelist_service):
        for actor in (self.member, self.superuser_only):
            self.client.force_authenticate(actor)
            for method, url, data in self._operator_route_requests():
                with self.subTest(actor=actor.email, method=method, url=url):
                    response = getattr(self.client, method)(url, data, format="json")
                    self.assertEqual(response.status_code, 403)

        self.assertEqual(whitelist_service.mock_calls, [])

    @patch("whitelist.views.entry.whitelist")
    def test_anonymous_cannot_use_operator_routes(self, whitelist_service):
        for method, url, data in self._operator_route_requests():
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data, format="json")
                self.assertEqual(response.status_code, 401)

        self.assertEqual(whitelist_service.mock_calls, [])

    def test_staff_can_list_retrieve_and_export_global_operator_rows(self):
        self.client.force_authenticate(self.staff)

        list_response = self.client.get(self.list_url)
        retrieve_response = self.client.get(self.detail_url)
        export_response = self.client.get(self.export_url)

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(
            {entry["uuid"] for entry in list_response.json()["results"]},
            {str(self.entry.uuid), str(self.foreign_entry.uuid)},
        )
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.json()["uuid"], str(self.entry.uuid))
        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response["Content-Type"], "text/csv")
        exported = export_response.content.decode()
        self.assertIn(self.wallet.address, exported)
        self.assertIn(f"{self.foreign_wallet.address},{self.company.name},Active,", exported)
        self.assertIn(f"{self.wallet.address},,No approval,", exported)
        foreign = next(row for row in list_response.json()["results"] if row["uuid"] == str(self.foreign_entry.uuid))
        self.assertEqual(
            [(approval["company"], approval["status"]) for approval in foreign["approvals"]],
            [(str(self.company.pk), "active")],
        )

    def test_staff_can_filter_entries_by_company_approval(self):
        self.client.force_authenticate(self.staff)

        response = self.client.get(self.list_url, {"company": str(self.company.pk), "status": "active"})

        self.assertEqual([entry["uuid"] for entry in response.json()["results"]], [str(self.foreign_entry.uuid)])

    def test_staff_can_use_all_operator_custom_actions(self):
        node = WhitelistNode()
        admitted_signer()
        self.client.force_authenticate(self.staff)
        with patch("whitelist.services.changes.get_base_chain_client", return_value=node.client), patch.object(
            whitelist, "get_base_chain_client", return_value=node.client
        ):
            add_response = self.client.post(
                self.add_url, self.terms(submissionId=str(uuid4()), expiresAt="2099-01-01T00:00:00Z"), format="json"
            )
            remove_response = self.client.post(self.remove_url, self.terms(submissionId=str(uuid4())), format="json")
            batch_response = self.client.post(
                self.batch_add_url, {"entries": [self.terms(submissionId=str(uuid4()))]}, format="json"
            )
            sync_response = self.client.post(self.sync_url)
        self.assertEqual(add_response.status_code, 201, add_response.data)
        self.assertEqual(add_response.json()["expiresAt"], "2099-01-01T00:00:00Z")
        self.assertEqual(add_response.json()["approval"]["expiresAt"], "2099-01-01T00:00:00Z")
        self.assertEqual(add_response.json()["company"], str(self.company.pk))
        self.assertEqual(remove_response.status_code, 200, remove_response.data)
        self.assertEqual(batch_response.status_code, 200, batch_response.data)
        self.assertEqual(batch_response.json()["successful"], 1)
        self.assertEqual(sync_response.status_code, 200)
        self.assertEqual(len(node.broadcasts), 3)

    def test_operator_submission_identity_is_required_before_admission(self):
        self.client.force_authenticate(self.staff)
        for url in (self.add_url, self.remove_url):
            for data in (self.terms(), {"walletAddress": self.wallet.address, "submissionId": str(uuid4())}):
                response = self.client.post(url, data, format="json")
                self.assertEqual(response.status_code, 400)
        self.assertFalse(WhitelistChange.objects.exists())

    def test_operator_pending_retry_preserves_identity_and_refuses_opposite_command(self):
        node = WhitelistNode(confirmed=False)
        admitted_signer()
        self.client.force_authenticate(self.staff)
        data = self.terms(submissionId=str(uuid4()))
        with patch("whitelist.services.changes.get_base_chain_client", return_value=node.client):
            first = self.client.post(self.add_url, data, format="json")
            replay = self.client.post(self.add_url, data, format="json")
            opposite = self.client.post(self.remove_url, data | {"submissionId": str(uuid4())}, format="json")
        self.assertEqual((first.status_code, replay.status_code, opposite.status_code), (202, 202, 409))
        self.assertEqual(first.json()["submissionId"], replay.json()["submissionId"])
        self.assertEqual(first.json()["txHash"], replay.json()["txHash"])
        self.assertFalse(replay.json()["success"])
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(node.broadcasts[0], node.broadcasts[1])

    def test_batch_unknown_membership_stays_pending_and_repeated_batch_recovers(self):
        node = WhitelistNode()
        admitted_signer()
        self.client.force_authenticate(self.staff)
        data = {"entries": [self.terms(submissionId=str(uuid4()))]}
        node.contract.functions.expiresAt.return_value.call.side_effect = ConnectionError("Synthetic unavailable")
        with patch("whitelist.services.changes.get_base_chain_client", return_value=node.client):
            pending = self.client.post(self.batch_add_url, data, format="json")
            node.contract.functions.expiresAt.return_value.call.side_effect = lambda: 0
            recovered = self.client.post(self.batch_add_url, data, format="json")
            replay = self.client.post(self.batch_add_url, data, format="json")
        self.assertEqual(pending.status_code, 200)
        self.assertEqual((pending.json()["pending"], pending.json()["failed"]), (1, 0))
        self.assertEqual(recovered.json()["successful"], 1)
        self.assertEqual(replay.json()["results"][0]["txHash"], recovered.json()["results"][0]["txHash"])
        self.assertEqual(len(node.broadcasts), 1)

    @patch("whitelist.views.entry.whitelist")
    def test_staff_standard_write_routes_are_absent_and_preserve_rows(self, whitelist_service):
        self.entry.notes = "preserve me"
        self.entry.save(update_fields=["notes", "updated_at"])
        original = {"wallet_id": self.entry.wallet_id, "label": self.entry.label, "notes": self.entry.notes}
        original_count = WhitelistEntry.objects.count()
        self.client.force_authenticate(self.staff)

        responses = [
            self.client.post(self.list_url, {"walletAddress": self.wallet.address}, format="json"),
            self.client.put(self.detail_url, {"status": "active"}, format="json"),
            self.client.patch(self.detail_url, {"status": "active"}, format="json"),
            self.client.delete(self.detail_url),
        ]

        for response in responses:
            self.assertEqual(response.status_code, 405)
        self.assertEqual(WhitelistEntry.objects.count(), original_count)
        self.entry.refresh_from_db()
        self.assertEqual(
            {"wallet_id": self.entry.wallet_id, "label": self.entry.label, "notes": self.entry.notes}, original
        )
        self.assertEqual(whitelist_service.mock_calls, [])

    def test_staff_by_address_succeeds(self):
        self.client.force_authenticate(self.staff)

        response = self.client.get(self.by_address_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["uuid"], str(self.entry.uuid))

    def test_staff_by_address_fails_closed_when_address_is_ambiguous(self):
        other_account = an_account("entry-scoping")
        duplicate_wallet = Wallet.objects.create(
            user_account=other_account,
            address=self.wallet.address,
            chain="base",
        )
        WhitelistEntry.objects.create(wallet=duplicate_wallet)
        self.client.force_authenticate(self.staff)

        response = self.client.get(self.by_address_url)

        self.assertEqual(response.status_code, 404)

    @patch("whitelist.views.entry.whitelist")
    def test_nonstaff_cannot_sync(self, whitelist_service):
        self.client.force_authenticate(self.member)

        response = self.client.post(self.sync_url)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(whitelist_service.mock_calls, [])

    @patch("whitelist.views.entry.whitelist")
    def test_staff_can_sync(self, whitelist_service):
        whitelist_service.sync_entry.return_value = self.entry
        self.client.force_authenticate(self.staff)

        response = self.client.post(self.sync_url)

        self.assertEqual(response.status_code, 200)
        whitelist_service.sync_entry.assert_called_once_with(
            self.wallet.address,
            wallet_uuid=self.wallet.uuid,
        )

    @patch("whitelist.views.entry.whitelist")
    def test_staff_sync_fails_closed_when_wallet_address_is_ambiguous(self, whitelist_service):
        other_account = an_account("entry-scoping")
        Wallet.objects.create(
            user_account=other_account,
            address=self.wallet.address,
            chain="base",
        )
        self.client.force_authenticate(self.staff)

        response = self.client.post(self.sync_url)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(whitelist_service.mock_calls, [])

    def test_sync_service_uses_explicit_wallet_uuid_when_duplicate_is_added(self):
        other_account = an_account("entry-scoping")
        Wallet.objects.create(
            user_account=other_account,
            address=self.wallet.address,
            chain="base",
        )
        entry = whitelist.sync_entry(self.wallet.address, wallet_uuid=self.wallet.uuid)

        self.assertEqual(entry.wallet_id, self.wallet.uuid)

    @patch("whitelist.views.entry.whitelist")
    def test_staff_sync_unknown_address_is_not_found_before_service(self, whitelist_service):
        self.client.force_authenticate(self.staff)

        response = self.client.post("/api/v1/whitelist/sync/0xcccccccccccccccccccccccccccccccccccccccc/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(whitelist_service.mock_calls, [])

    def test_add_rejects_unregistered_address_without_creating_rows(self):
        unknown = "0x" + "c" * 40

        with self.assertRaises(WalletNotRegisteredException):
            whitelist.resolve_entry(unknown)

        self.assertFalse(Wallet.objects.filter_by_address(unknown, chain="base").exists())
        self.assertFalse(WhitelistEntry.objects.filter(wallet__address__iexact=unknown).exists())
        self.assertFalse(BlockchainTransaction.objects.exists())

    def test_add_rejects_ambiguous_address(self):
        Wallet.objects.create(user_account=an_account("entry-scoping"), address=self.wallet.address, chain="base")

        with self.assertRaises(WalletNotRegisteredException):
            whitelist.resolve_entry(self.wallet.address)

        self.assertFalse(BlockchainTransaction.objects.exists())
