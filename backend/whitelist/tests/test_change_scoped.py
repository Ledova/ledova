from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import override_settings
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import receipt
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Wallet
from whitelist.models import WhitelistChange, WhitelistEntry
from whitelist.services import changes
from whitelist.tasks.recovery import recover_whitelist_changes
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    KEY,
    REGISTRY,
    WhitelistNode,
    admitted_signer,
    change_actor,
    change_entry,
)
from whitelist.tests.test_admin_blockchain_views import TEST_STORAGES


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    WHITELIST_CONTRACT_ADDRESS=REGISTRY,
    STORAGES=TEST_STORAGES,
)
class ScopedWhitelistChangeTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.actor = change_actor()
            self.entry = change_entry()
            admitted_signer()
        self.node = WhitelistNode()
        patcher = patch.object(changes, "get_base_chain_client", return_value=self.node.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_app_alias_cannot_admit_recover_or_read_private_commands(self):
        with use_operator():
            change = changes._admit(uuid4(), "add", ADDRESS, self.actor, "operator_api", None)
        with acting_for(self.actor.pk):
            for invoke in (
                lambda: changes.submit(uuid4(), "add", ADDRESS, self.actor),
                lambda: changes.recover(change.pk),
            ):
                with self.assertRaises(PermissionDenied):
                    invoke()
            with self.assertRaises(DatabaseError), atomic():
                WhitelistChange.objects.filter(pk=change.pk).exists()
        with use_operator():
            self.assertTrue(WhitelistChange.objects.filter(pk=change.pk).exists())
            self.assertFalse(SignedAttempt.objects.exists())
        self.node.client.load_contract.assert_not_called()

    def test_recovery_job_selects_operator_then_restores_app_principal(self):
        with use_operator():
            changes._admit(uuid4(), "add", ADDRESS, self.actor, "operator_api", None)
        send = self.node.send
        seen = []

        def observe(raw):
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            self.assertTrue(connections[current_alias()].get_autocommit())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                seen.append(cursor.fetchone()[0])
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        with acting_for(self.actor.pk):
            self.assertEqual(recover_whitelist_changes.func(), {"checked": 1, "completed": 1, "unresolved": 0})
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.actor.pk))
        self.assertEqual(seen, [settings.RLS_ROLES[OPERATOR_ALIAS]])

    def test_operator_api_commits_and_recovers_original_identity(self):
        self.client.force_authenticate(self.actor)
        incoming = {"submissionId": str(uuid4()), "walletAddress": ADDRESS}
        response = self.client.post("/api/v1/whitelist/add/", incoming, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        repeated = self.client.post("/api/v1/whitelist/add/", incoming, format="json")
        self.assertEqual(repeated.json()["txHash"], response.json()["txHash"])
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(current_alias(), APP_ALIAS)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get().initiated_by_id, self.actor.pk)

    def test_admin_confirmation_preserves_identity_across_repeated_posts(self):
        with use_operator():
            self.client.force_login(self.actor)
        url = reverse("admin:whitelist_whitelistentry_add_to_blockchain", args=[self.entry.pk])
        page = self.client.get(url)
        self.assertEqual(page.status_code, 200)
        self.node.client.send_raw_transaction.assert_not_called()
        incoming = {"confirm_whitelist": "1", "whitelist_confirmation": page.context["whitelist_confirmation"]}
        response = self.client.post(url, incoming)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.post(url, incoming).status_code, 302)
        self.assertEqual(len(self.node.broadcasts), 1)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get().authority, "whitelist_admin")
            self.assertEqual(WhitelistChange.objects.get().status, "confirmed")

    def test_customer_can_delete_a_wallet_with_an_unadmitted_whitelist_entry(self):
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
        self.signed_in_as(customer)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())

    def test_customer_deletion_preserves_private_command_without_recreating_or_reassigning_entry(self):
        self.node.confirmed = False
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
            original = changes.submit(uuid4(), "add", ADDRESS, self.actor)
            attempt = SignedAttempt.objects.get()
        self.signed_in_as(customer)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        with self.assertRaises(DatabaseError), atomic():
            WhitelistChange.objects.filter(pk=original.pk).exists()
        with use_operator():
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
            replacement_wallet = Wallet.objects.create(user_account=wallet.user_account, address=ADDRESS, chain="base")
            replacement = WhitelistEntry.objects.create(wallet=replacement_wallet)
            self.node.receipts[attempt.tx_hash] = receipt(attempt)
            recovered = changes.recover(original.pk)
            self.assertEqual(recovered.status, "confirmed")
            self.assertEqual(recovered.entry_id, self.entry.pk)
            self.assertIsNone(recovered.entry)
            self.assertEqual(recovered.transaction.tx_hash, attempt.tx_hash)
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
            replacement.refresh_from_db()
            self.assertFalse(replacement.is_whitelisted)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_customer_wallet_address_edit_cannot_receive_the_original_address_receipt(self):
        self.node.confirmed = False
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
            original = changes.submit(uuid4(), "add", ADDRESS, self.actor)
            attempt = SignedAttempt.objects.get()
        self.signed_in_as(customer)
        response = self.client.patch(f"/api/wallets/{wallet.pk}/", {"address": "0x" + "b" * 40}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        with use_operator():
            self.node.receipts[attempt.tx_hash] = receipt(attempt)
            recovered = changes.recover(original.pk)
            self.assertEqual(recovered.status, "confirmed")
            self.assertIsNone(recovered.entry)
            self.entry.refresh_from_db()
            self.assertFalse(self.entry.is_whitelisted)
            self.assertIsNone(self.entry.add_tx_hash)
        self.assertEqual(len(self.node.broadcasts), 1)
