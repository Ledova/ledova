from unittest.mock import patch

from django.test import TestCase, override_settings

from shared.tests.tenants import make_tenant
from tokens.exceptions import InvalidTokenStateException, TokenPauseFailedException
from tokens.models import ShareTokenStatus
from tokens.services import share_token_service

RECEIPT = {"blockNumber": 9, "blockHash": bytes.fromhex("ab" * 32), "gasUsed": 1000000}
CHAIN_CLIENT = "tokens.services.share_token_service.get_base_chain_client"


@override_settings(BLOCKCHAIN_OPERATOR_KEY="0xkey")
class PauseTest(TestCase):
    def setUp(self):
        self.chain = patch(CHAIN_CLIENT).start().return_value
        self.addCleanup(patch.stopall)
        self.chain.send_transaction.return_value = ("0xpause", RECEIPT)
        self.tenant = make_tenant("owner")
        self.token = self.tenant.deployed_token
        self.service = share_token_service
        self._chain_paused(False)

    def _contract(self):
        return self.chain.load_contract.return_value

    def _chain_paused(self, *states):
        reads = self._contract().functions.paused.return_value.call
        reads.side_effect = list(states[:-1]) + [states[-1]] * 8

    def test_pause_and_unpause_send_the_owner_calls_then_move_status(self):
        self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)
        self.chain.send_transaction.assert_called_once_with(
            self._contract().functions.pause.return_value, "0xkey", wait_for_receipt=True
        )

        self._chain_paused(True)
        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertEqual(self.chain.send_transaction.call_args.args[0], self._contract().functions.unpause.return_value)

    def test_chain_failure_keeps_the_status_and_surfaces(self):
        self.chain.send_transaction.side_effect = RuntimeError("execution reverted")
        with self.assertRaisesMessage(TokenPauseFailedException, "Token pause failed."):
            self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)

    def test_receipt_lost_after_the_call_mined_reconciles_the_status(self):
        self.chain.send_transaction.side_effect = RuntimeError("rpc timed out")
        self._chain_paused(False, True)
        self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)
        self.chain.send_transaction.assert_called_once()

        self._chain_paused(True, False)
        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)

    def test_chain_already_in_the_target_state_is_reconciled_without_sending(self):
        self._chain_paused(True)
        self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)

        self._chain_paused(False)
        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.chain.send_transaction.assert_not_called()

    def test_deployed_token_the_chain_reports_paused_can_be_unpaused(self):
        self._chain_paused(True)
        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertEqual(self.chain.send_transaction.call_args.args[0], self._contract().functions.unpause.return_value)

    def test_unreadable_paused_state_surfaces_before_any_call(self):
        self._contract().functions.paused.return_value.call.side_effect = ConnectionError("rpc down")
        with self.assertRaisesMessage(TokenPauseFailedException, "The token's paused state could not be read."):
            self.service.pause(self.token)
        self.chain.send_transaction.assert_not_called()

    def test_wrong_state_is_refused_before_any_call(self):
        with self.assertRaises(InvalidTokenStateException):
            self.service.unpause(self.token)
        with self.assertRaises(InvalidTokenStateException):
            self.service.pause(self.tenant.token)
        self.chain.send_transaction.assert_not_called()
