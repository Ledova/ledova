from django.contrib import admin
from django.test import TransactionTestCase, override_settings
from requests.exceptions import ConnectionError as RequestsConnectionError

from blockchain.models import BlockchainTransaction
from tokens.admin.capital_increase import CapitalIncreaseAdmin
from tokens.admin.share_issuance_request import ShareIssuanceRequestAdmin
from tokens.models import (
    CapitalIncreaseRequest,
    ShareIssuanceRequest,
)
from tokens.serializers import CapitalIncreaseDetailSerializer
from tokens.serializers.share_issuance_request import ShareIssuanceRequestSerializer
from tokens.services import capital_execution, issuance_execution
from tokens.tests.capital_fixtures import CHAIN_ID
from tokens.tests.capital_fixtures import KEY as CAPITAL_KEY
from tokens.tests.capital_fixtures import admit, install_capital
from tokens.tests.issuance_fixtures import admit as admit_issuance
from tokens.tests.issuance_fixtures import install_issuance

KEY = "pR3t3nd1ngT0B3aReAlK3y"
RPC_URL = f"https://base-sepolia.g.alchemy.com/v2/{KEY}"
PROVIDER_TEXT = f"Max retries exceeded with url: {RPC_URL}"


@override_settings(BLOCKCHAIN_OPERATOR_KEY=CAPITAL_KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class WhatTheIssuerReadsAfterAFailedExecutionTest(TransactionTestCase):
    def setUp(self):
        install_issuance(self)

    def a_failed_issuance(self):
        self.node.client.estimate_gas.side_effect = RequestsConnectionError(PROVIDER_TEXT)
        command = admit_issuance(self.request, self.actor)
        with self.assertLogs("tokens.services.issuance_execution", "WARNING") as logged:
            self.assertEqual(issuance_execution.recover(command.pk)["status"], "failed")
        self.assertNotIn(KEY, str(logged.output))
        self.request.refresh_from_db()
        return self.request

    def test_the_node_key_never_reaches_the_issuer_through_an_issuance_request(self):
        served = str(ShareIssuanceRequestSerializer(self.a_failed_issuance()).data)
        self.assertNotIn(KEY, served)
        self.assertNotIn("alchemy.com", served)
        self.assertIn("Issuance preparation failed before a transaction was signed", served)

    def test_confirmed_unsigned_failure_explains_that_no_transaction_was_signed(self):
        request = self.a_failed_issuance()
        self.assertIn("before a transaction was signed", request.execution_notes)
        self.assertEqual(request.review_notes, "")
        self.assertTrue(request.can_be_executed)
        self.assertFalse(
            BlockchainTransaction.objects.filter(
                related_model=ShareIssuanceRequest._meta.label, related_uuid=request.pk
            ).exists()
        )

    def test_the_admin_reports_original_hash_and_safe_error_category_for_unknown_delivery(self):
        self.node.client.send_raw_transaction.side_effect = RequestsConnectionError(PROVIDER_TEXT)
        command = admit_issuance(self.request, self.actor)
        self.assertEqual(issuance_execution.recover(command.pk)["status"], "executing")
        self.request.refresh_from_db()
        shown = ShareIssuanceRequestAdmin(ShareIssuanceRequest, admin.site).last_execution_error(self.request)
        self.assertIn(BlockchainTransaction.objects.get().tx_hash, shown)
        self.assertIn("ConnectionError", shown)
        self.assertNotIn(KEY, shown)
        self.assertFalse(self.request.can_be_executed)
        self.assertNotIn(KEY, str(ShareIssuanceRequestSerializer(self.request).data))

    def test_an_issuance_request_that_never_failed_shows_no_error_row(self):
        shown = ShareIssuanceRequestAdmin(ShareIssuanceRequest, admin.site).last_execution_error(self.request)
        self.assertEqual(shown, "-")

    def test_internal_and_legacy_review_notes_remain_available_only_to_the_operator(self):
        for request, serializer in (
            (self.request, ShareIssuanceRequestSerializer),
            (self.tenant.capital_increase, CapitalIncreaseDetailSerializer),
        ):
            for note in (f"Reviewer diagnostic: {PROVIDER_TEXT}", f"Execution failed: {PROVIDER_TEXT}"):
                request.review_notes = note
                request.save(update_fields=["review_notes"])
                served = serializer(request).data
                self.assertNotIn("review_notes", served)
                self.assertNotIn(KEY, str(served))
                request.refresh_from_db()
                self.assertEqual(request.review_notes, note)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=CAPITAL_KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class CapitalRecoveryDiagnosticTest(TransactionTestCase):
    def setUp(self):
        install_capital(self)

    def test_unsigned_preparation_failure_reports_safe_capital_reason_once(self):
        self.node.client.estimate_gas.side_effect = RequestsConnectionError(PROVIDER_TEXT)
        command = admit(self.request, self.actor)
        with self.assertLogs("tokens.services.capital_execution", "WARNING") as logged:
            self.assertEqual(capital_execution.recover(command.pk)["status"], "failed")
        self.assertEqual(len(logged.output), 1)
        self.assertNotIn(KEY, str(logged.output))
        self.request.refresh_from_db()
        served = str(CapitalIncreaseDetailSerializer(self.request).data)
        self.assertIn("Capital preparation failed before a transaction was signed", served)
        self.assertNotIn(KEY, served)
        self.assertNotIn("alchemy.com", served)
        self.assertEqual(self.request.review_notes, "")

    def test_unknown_send_retains_hash_and_safe_operator_category_without_leaking_provider_url(self):
        self.node.client.send_raw_transaction.side_effect = RequestsConnectionError(PROVIDER_TEXT)
        command = admit(self.request, self.actor)
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executing")
        self.request.refresh_from_db()
        recorded = BlockchainTransaction.objects.get()
        shown = CapitalIncreaseAdmin(CapitalIncreaseRequest, admin.site).last_execution_error(self.request)
        self.assertIn(recorded.tx_hash, shown)
        self.assertIn("ConnectionError", shown)
        self.assertNotIn(KEY, shown)
        self.assertNotIn(KEY, str(CapitalIncreaseDetailSerializer(self.request).data))
        self.assertEqual(recorded.status, "submitted")
