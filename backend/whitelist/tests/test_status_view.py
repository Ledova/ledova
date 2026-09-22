from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.test import TestCase
from rest_framework.test import APITestCase
from web3 import Web3

from shared.tests.tenants import make_tenant
from whitelist.constants import (
    WHITELIST_STATUS_NOT_WHITELISTED,
    WHITELIST_STATUS_UNKNOWN,
    WHITELIST_STATUS_WHITELISTED,
)
from whitelist.services import whitelist

ADDRESS = "0x" + "a" * 40
TOKEN_ADDRESS = "0x" + "1" * 40
REGISTRY = Web3.to_checksum_address("0x" + "2" * 40)


class WhitelistInvestorStatusServiceTest(TestCase):
    def setUp(self):
        self.token = SimpleNamespace(uuid=uuid4(), pk=uuid4(), contract_address=TOKEN_ADDRESS)
        self.share_token = Mock()
        self.share_token.functions.whitelist.return_value.call.return_value = REGISTRY
        self.registry = Mock()
        self.client = Mock()
        self.client.load_contract.side_effect = lambda name, address: {
            "ShareToken": self.share_token,
            "WhitelistRegistry": self.registry,
        }[name]
        patcher = patch.object(whitelist, "get_base_chain_client", return_value=self.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def listed(self, value):
        self.registry.functions.isWhitelisted.return_value.call.return_value = value

    def test_a_whitelisted_address_reports_the_whitelisted_state(self):
        self.listed(True)

        self.assertEqual(
            whitelist.investor_status(self.token, ADDRESS),
            {
                "address": "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
                "is_whitelisted": True,
                "status": WHITELIST_STATUS_WHITELISTED,
            },
        )

    def test_the_answer_comes_from_the_registry_the_token_itself_checks(self):
        self.listed(True)

        whitelist.investor_status(self.token, ADDRESS)

        self.assertEqual(
            [call.args for call in self.client.load_contract.call_args_list],
            [("ShareToken", Web3.to_checksum_address(TOKEN_ADDRESS)), ("WhitelistRegistry", REGISTRY)],
        )
        self.registry.functions.isWhitelisted.assert_called_once_with(Web3.to_checksum_address(ADDRESS))

    def test_an_address_the_chain_says_is_absent_reports_not_whitelisted(self):
        self.listed(False)

        self.assertEqual(whitelist.investor_status(self.token, ADDRESS)["status"], WHITELIST_STATUS_NOT_WHITELISTED)

    def test_a_chain_error_is_reported_as_unknown_rather_than_a_refusal(self):
        self.registry.functions.isWhitelisted.return_value.call.side_effect = RuntimeError("rpc down")

        self.assertEqual(
            whitelist.investor_status(self.token, ADDRESS),
            {"address": ADDRESS, "is_whitelisted": False, "status": WHITELIST_STATUS_UNKNOWN},
        )

    def test_an_answer_that_is_not_a_boolean_is_unknown(self):
        self.listed(Mock())

        self.assertEqual(whitelist.investor_status(self.token, ADDRESS)["status"], WHITELIST_STATUS_UNKNOWN)

    def test_the_unknown_answer_reports_the_address_as_given_because_checksumming_is_what_failed(self):
        self.listed(True)

        self.assertEqual(whitelist.investor_status(self.token, "nonsense")["address"], "nonsense")


class WhitelistStatusViewTest(APITestCase):
    def setUp(self):
        self.tenant = make_tenant("wlstatus")
        self.token = self.tenant.deployed_token
        self.client.force_authenticate(self.tenant.user)
        self.url = (
            f"/api/v1/trading/whitelist/{self.token.contract_address.upper().replace('0X', '0x')}/{ADDRESS}/status/"
        )

    def _view_over(self, payload):
        service = Mock(return_value=payload)
        return patch.object(whitelist, "investor_status", service), service

    def test_the_view_renders_what_the_service_answers_for_the_token_at_that_address(self):
        patcher, service = self._view_over(
            {"address": ADDRESS, "is_whitelisted": True, "status": WHITELIST_STATUS_WHITELISTED}
        )
        with patcher:
            response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "address": ADDRESS,
                "isWhitelisted": True,
                "status": WHITELIST_STATUS_WHITELISTED,
            },
        )
        service.assert_called_once_with(self.token, ADDRESS)

    def test_an_unknown_answer_is_still_a_200(self):
        patcher, _ = self._view_over({"address": ADDRESS, "is_whitelisted": False, "status": WHITELIST_STATUS_UNKNOWN})
        with patcher:
            response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], WHITELIST_STATUS_UNKNOWN)

    def test_a_token_that_is_not_on_chain_or_not_visible_is_not_found(self):
        stranger = make_tenant("wlstatus-stranger")
        patcher, service = self._view_over({})
        with patcher:
            for token in (self.tenant.token.uuid, stranger.token.uuid, "0x" + "9" * 40):
                with self.subTest(token=token):
                    response = self.client.get(f"/api/v1/trading/whitelist/{token}/{ADDRESS}/status/")
                    self.assertEqual(response.status_code, 404)
        service.assert_not_called()

    def test_an_anonymous_caller_is_refused(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.client.get(self.url).status_code, 401)
