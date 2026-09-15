from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied

from blockchain.models import OutgoingOperation, SignedAttempt
from blockchain.services import outgoing
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
from tokens.models import MintRequest
from tokens.services import mint_service
from tokens.tasks.mint_request import recover_mint_requests
from tokens.tests.mint_request_fixtures import (
    CHAIN_ID,
    KEY,
    SENDER,
    TARGET,
    MintNode,
    admitted_signer,
    mint_request,
)
from tokens.tests.test_mint_admin import TEST_STORAGES, mint_data


@override_settings(STORAGES=TEST_STORAGES, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ScopedMintRequestRecoveryTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.actor = get_user_model().objects.create_superuser(
                email="scoped-mint@example.test", password="synthetic"
            )
            self.reader = get_user_model().objects.create_user(
                email="reader@example.test", password="synthetic", is_staff=True, is_active=True
            )
            self.request = mint_request(self.actor)
            admitted_signer()
        self.node = MintNode()
        patcher = patch("tokens.services.mint_service.get_base_chain_client", return_value=self.node.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_app_authority_cannot_admit_or_recover_even_with_a_staff_principal(self):
        with use_operator():
            control = outgoing.open_operation("scoped-control", chain_id=CHAIN_ID, sender=SENDER, to=TARGET)
        with acting_for(self.actor.pk):
            for call in (
                lambda: mint_service.execute(self.request, self.actor),
                lambda: mint_service.recover(self.request.pk),
            ):
                with self.assertRaises(PermissionDenied):
                    call()
            with self.assertRaises(DatabaseError), atomic():
                MintRequest.objects.filter(pk=self.request.pk).exists()
            self.assertFalse(OutgoingOperation.objects.filter(pk=control.operation_id).exists())
        with use_operator():
            self.assertTrue(OutgoingOperation.objects.filter(pk=control.operation_id).exists())
            self.request.refresh_from_db()
            self.assertIsNone(self.request.execution_intent)
        self.node.client.send_raw_transaction.assert_not_called()

    def test_worker_selects_operator_and_restores_the_ambient_principal(self):
        with use_operator():
            mint_service._admit(self.request.pk, self.actor, "tokens.change_mintrequest", "")
        send = self.node.send
        seen = []

        def observe(raw):
            connection = connections[current_alias()]
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            self.assertTrue(connection.get_autocommit())
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                seen.append(cursor.fetchone()[0])
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        with acting_for(self.reader.pk):
            self.assertEqual(recover_mint_requests.func(), {"executed": 1})
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.reader.pk))
        self.assertEqual(seen, [settings.RLS_ROLES[OPERATOR_ALIAS]])
        with use_operator():
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertEqual(MintRequest.objects.get(pk=self.request.pk).executed_by_id, self.actor.pk)

    def test_admin_mint_runs_under_operator_authority(self):
        with use_operator():
            self.client.force_login(self.actor)
        url = reverse("admin:assets_asset_mint", args=[self.request.settlement_asset_id])
        response = self.client.post(url, mint_data("3.00"))
        self.assertEqual(response.status_code, 302)
        with use_operator():
            completed = MintRequest.objects.get(status="executed")
            self.assertEqual(completed.amount, 300)
            self.assertEqual(completed.executed_by_id, self.actor.pk)
            self.assertEqual(completed.transaction.tx_hash, SignedAttempt.objects.get().tx_hash)
        self.assertEqual(current_alias(), APP_ALIAS)

    def test_operator_retry_retains_interrupted_revert_and_restores_app_principal(self):
        project = mint_service._project

        def interrupt(request_id, claim):
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            if OutgoingOperation.objects.get(pk=claim.operation_id).status == "reverted":
                raise SystemExit("Stopped before projecting the revert")
            return project(request_id, claim)

        with acting_for(self.reader.pk):
            with use_operator():
                self.node.receipt_status = 0
                with patch.object(mint_service, "_project", interrupt), self.assertRaises(SystemExit):
                    mint_service.execute(self.request, self.actor)
                self.request.refresh_from_db()
                previous, operation = self.request.transaction, self.request.operation
                self.assertEqual(previous.status, "submitted")
                self.node.receipt_status = 1
                mint_service.execute(self.request, self.actor, retry_of=operation.claim_id)
                previous.refresh_from_db()
                self.assertEqual(previous.status, "reverted")
                self.assertEqual(previous.block_number, operation.block_number)
                self.assertEqual(previous.block_hash, operation.block_hash)
                self.assertEqual(previous.gas_used, operation.gas_used)
                self.assertEqual(self.request.status, "executed")
                self.assertEqual(SignedAttempt.objects.count(), 2)
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.reader.pk))
            with self.assertRaises(PermissionDenied):
                mint_service.execute(self.request, self.actor, retry_of=operation.claim_id)

    def test_staff_without_the_model_permission_cannot_use_operator_admin_entry(self):
        with use_operator():
            self.client.force_login(self.reader)
        url = reverse("admin:tokens_mintrequest_execute", args=[self.request.pk])
        self.assertEqual(self.client.post(url, {"confirm": "on"}).status_code, 403)
        with use_operator():
            self.assertFalse(OutgoingOperation.objects.exists())
        self.node.client.send_raw_transaction.assert_not_called()
