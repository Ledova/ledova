from unittest.mock import MagicMock, patch

from django.test import TestCase

from shared.tests.tenants import make_tenant
from tokens.exceptions import NotWhitelistedException
from tokens.services import token_transfer_service

SENDER = "0x" + "1" * 40
RECIPIENT = "0x" + "2" * 40


class TransferWhitelistScopeTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("transfer-scope")
        client = MagicMock()
        client.is_valid_address.return_value = True
        self.enterContext(patch.object(token_transfer_service, "get_base_chain_client", return_value=client))
        self.balances = self.enterContext(patch("tokens.services.share_token_service.get_token_balance"))
        self.balances.return_value = 100
        self.whitelist = self.enterContext(patch.object(token_transfer_service, "whitelist"))

    def validate(self, token):
        token_transfer_service.validate_transfer(token, SENDER, RECIPIENT, 1)

    def test_a_share_transfer_asks_the_registry_of_that_share_token_about_both_parties(self):
        token = self.tenant.deployed_token
        self.whitelist.is_whitelisted.return_value = True

        self.validate(token)

        self.assertEqual(
            [call.args for call in self.whitelist.is_whitelisted.call_args_list],
            [(token.contract_address, SENDER), (token.contract_address, RECIPIENT)],
        )

    def test_a_share_transfer_is_refused_for_an_unlisted_sender_before_the_recipient_is_asked(self):
        self.whitelist.is_whitelisted.side_effect = lambda token, address: address != SENDER

        with self.assertRaises(NotWhitelistedException) as refusal:
            self.validate(self.tenant.deployed_token)

        self.assertIn(SENDER, str(refusal.exception.detail))
        self.assertEqual(self.whitelist.is_whitelisted.call_count, 1)

    def test_a_share_transfer_is_refused_for_an_unlisted_recipient(self):
        self.whitelist.is_whitelisted.side_effect = lambda token, address: address != RECIPIENT

        with self.assertRaises(NotWhitelistedException) as refusal:
            self.validate(self.tenant.deployed_token)

        self.assertIn(RECIPIENT, str(refusal.exception.detail))

    def test_a_stablecoin_transfer_asks_for_an_approval_with_any_company(self):
        self.whitelist.approved_for_any_company.return_value = True

        self.validate(self.tenant.refs.stablecoin)

        self.whitelist.is_whitelisted.assert_not_called()
        self.assertEqual(
            [call.args for call in self.whitelist.approved_for_any_company.call_args_list],
            [(SENDER,), (RECIPIENT,)],
        )
        self.balances.assert_called_once()

    def test_a_stablecoin_transfer_is_refused_for_a_party_approved_nowhere(self):
        self.whitelist.approved_for_any_company.side_effect = lambda address: address != RECIPIENT

        with self.assertRaises(NotWhitelistedException) as refusal:
            self.validate(self.tenant.refs.stablecoin)

        self.assertIn(RECIPIENT, str(refusal.exception.detail))
        self.whitelist.is_whitelisted.assert_not_called()
