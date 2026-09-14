from unittest.mock import patch

from django.contrib import admin
from django.test import TestCase, TransactionTestCase, override_settings
from requests.exceptions import ConnectionError as RequestsConnectionError
from web3 import Web3

from blockchain.models import BlockchainTransaction
from shared.tests.tenants import make_tenant
from tokens.admin.capital_increase import CapitalIncreaseAdmin
from tokens.admin.share_issuance_request import ShareIssuanceRequestAdmin
from tokens.models import (
    CapitalIncreaseRequest,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.serializers import CapitalIncreaseDetailSerializer
from tokens.serializers.share_issuance_request import ShareIssuanceRequestSerializer
from tokens.services import capital_execution, share_token_service
from tokens.services.share_token_service import (
    ISSUANCE_EXECUTION_FAILED,
)
from tokens.tests.capital_fixtures import CHAIN_ID
from tokens.tests.capital_fixtures import KEY as CAPITAL_KEY
from tokens.tests.capital_fixtures import admit, install_capital
from tokens.tests.test_review_requests import (
    CHAIN_CLIENT,
    SIGNER,
    SUPPLY,
    WHITELISTED,
    issuance_request,
)

KEY = "pR3t3nd1ngT0B3aReAlK3y"
RPC_URL = f"https://base-sepolia.g.alchemy.com/v2/{KEY}"
PROVIDER_TEXT = f"Max retries exceeded with url: {RPC_URL}"


class WhatTheIssuerReadsAfterAFailedExecutionTest(TestCase):

    def setUp(self):
        chain = patch(CHAIN_CLIENT).start().return_value
        self.chain = chain
        chain.is_valid_address.return_value = True
        chain.to_checksum_address.side_effect = Web3.to_checksum_address
        chain.get_address_from_private_key.return_value = SIGNER
        chain.load_contract.return_value.functions.paused.return_value.call.return_value = False
        patch(WHITELISTED, return_value=True).start()
        patch(SUPPLY, return_value=(1000, 0)).start()
        self.addCleanup(patch.stopall)
        self.tenant = make_tenant("failednote")
        self.token = self.tenant.deployed_token
        self.service = share_token_service

    def _approved(self, request):
        request.status = RequestStatus.APPROVED
        request.reviewed_by = self.tenant.user
        request.save(update_fields=["status", "reviewed_by", "updated_at"])
        return request

    def a_failed_issuance(self):
        request = self._approved(issuance_request(self.token))
        with patch.object(share_token_service, "_mint_to", side_effect=RequestsConnectionError(PROVIDER_TEXT)):
            with self.assertRaises(RequestsConnectionError):
                self.service.execute_request(request)
        request.refresh_from_db()
        return request

    def test_the_node_key_never_reaches_the_issuer_through_an_issuance_request(self):
        request = self.a_failed_issuance()

        served = str(ShareIssuanceRequestSerializer(request).data)

        self.assertNotIn(KEY, served)
        self.assertNotIn("alchemy.com", served)
        self.assertIn(ISSUANCE_EXECUTION_FAILED, served)

    def test_the_note_requires_an_operator_to_check_the_chain_before_retrying(self):
        request = self.a_failed_issuance()

        self.assertIn("could not be confirmed", request.execution_notes)
        self.assertIn("An operator must check", request.execution_notes)
        self.assertIn("on-chain state before deciding whether to retry", request.execution_notes)
        self.assertEqual(request.review_notes, "")
        self.assertTrue(request.can_be_executed)

    def test_the_operator_keeps_the_diagnostic_the_issuer_does_not_get(self):
        self.a_failed_issuance()

        issuance = ShareIssuance.objects.get(token=self.token)

        self.assertIn(KEY, issuance.error_message)

    def test_a_request_that_never_failed_shows_no_error_row(self):
        request = self._approved(self.tenant.capital_increase)

        shown = CapitalIncreaseAdmin(CapitalIncreaseRequest, admin.site).last_execution_error(request)

        self.assertEqual(shown, "-")

    def issuance_admin(self):
        return ShareIssuanceRequestAdmin(ShareIssuanceRequest, admin.site)

    def test_the_admin_puts_the_issuance_diagnostic_in_front_of_the_operator_too(self):
        request = self.a_failed_issuance()

        shown = self.issuance_admin().last_execution_error(request)

        self.assertIn(KEY, shown)

    def test_an_issuance_request_that_never_failed_shows_no_error_row(self):
        request = self._approved(issuance_request(self.token))

        shown = self.issuance_admin().last_execution_error(request)

        self.assertEqual(shown, "-")

    def test_the_issuance_request_carries_no_blockchain_transaction_of_its_own(self):
        request = self.a_failed_issuance()

        self.assertFalse(
            BlockchainTransaction.objects.filter(
                related_model=ShareIssuanceRequest._meta.label, related_uuid=request.uuid
            ).exists()
        )

    def test_internal_and_legacy_review_notes_remain_available_only_to_the_operator(self):
        for request, serializer in (
            (self._approved(issuance_request(self.token)), ShareIssuanceRequestSerializer),
            (self._approved(self.tenant.capital_increase), CapitalIncreaseDetailSerializer),
        ):
            with self.subTest(request=type(request).__name__):
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
