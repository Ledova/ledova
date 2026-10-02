import logging
from unittest.mock import Mock, patch

import requests
from django.conf import settings
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase
from web3 import Web3
from web3.exceptions import BadFunctionCallOutput, ContractLogicError, Web3RPCError

from assets.models import Asset, AssetChainDeployment
from feature_flags.models import FeatureFlag
from integrations.base_chain import get_base_chain_client
from integrations.base_chain.exceptions import BaseChainConnectionError
from operators.models import Operator
from shared.tests.tenants import make_tenant
from tokens.exceptions import WalletBalancesUnavailableException
from tokens.services import share_token_service
from tokens.tests.rpc_fixtures import ScriptedNode
from tokens.tests.test_chain_integration import reset_chain_client

BALANCES = "/api/v1/trading/wallets/balances/"


class BalancesRefuseRatherThanGuessTest(APITestCase):

    def setUp(self):
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        self.tenant = make_tenant("balances")
        self.client.force_authenticate(self.tenant.user)

    def _get(self):
        return self.client.get(BALANCES, {"wallet_address": self.tenant.wallet.address})

    @patch("tokens.views.trading_wallet.share_token_service")
    def test_a_cold_client_that_cannot_connect_refuses_rather_than_erroring(self, service_class):
        service_class.get_wallet_token_balances.side_effect = BaseChainConnectionError(
            "Failed to connect to configured EVM endpoint"
        )

        response = self._get()

        self.assertEqual(response.status_code, 503)
        self.assertIn("could not be reached", response.json()["detail"])

    @patch("tokens.views.trading_wallet.share_token_service")
    def test_a_warm_client_that_cannot_read_refuses_rather_than_answering_nothing(self, service_class):
        service_class.get_wallet_token_balances.side_effect = WalletBalancesUnavailableException(
            "The balance of QAT could not be read: boom"
        )

        response = self._get()

        self.assertEqual(response.status_code, 503)
        self.assertIn("QAT", response.json()["detail"])

    def logged_text(self, records):
        formatter = logging.Formatter()
        return "\n".join(formatter.format(record) for record in records)

    def keyed_failure(self):
        failure = requests.ConnectionError("Max retries exceeded with url: /v2/SECRET-KEY")
        failure.request = requests.Request("POST", "https://base.provider.example/v2/SECRET-KEY").prepare()
        return failure

    def test_a_refusal_never_carries_the_providers_error_into_any_logged_traceback(self):
        with (
            patch.object(share_token_service, "_validate_address", side_effect=lambda address: address),
            patch.object(share_token_service, "_get_balance", side_effect=self.keyed_failure()),
            self.assertLogs(level="ERROR") as logged,
        ):
            response = self._get()

        self.assertEqual(response.status_code, 503, response.content)
        self.assertNotIn("SECRET-KEY", self.logged_text(logged.records))
        self.assertIn("ConnectionError from base.provider.example", self.logged_text(logged.records))

    def test_a_cold_client_refusal_never_carries_the_providers_error_into_any_logged_traceback(self):
        def cold(address):
            try:
                raise self.keyed_failure()
            except requests.ConnectionError as failure:
                raise BaseChainConnectionError("Failed to connect to configured EVM endpoint") from failure

        with (
            patch.object(share_token_service, "_validate_address", side_effect=cold),
            self.assertLogs(level="ERROR") as logged,
        ):
            response = self._get()

        self.assertEqual(response.status_code, 503, response.content)
        self.assertNotIn("SECRET-KEY", self.logged_text(logged.records))

    @patch("tokens.views.trading_wallet.share_token_service")
    def test_a_readable_chain_still_answers_two_hundred(self, service_class):
        service_class.get_wallet_token_balances.return_value = {"balances": []}

        self.assertEqual(self._get().status_code, 200)


class TheServiceRefusesAPartialAnswerTest(TestCase):

    def setUp(self):
        self.tenant = make_tenant("partial")
        self.service = share_token_service
        self.enterContext(patch.object(share_token_service, "_validate_address", side_effect=lambda address: address))

    def _stablecoin(self):
        operator = Operator.get()
        asset = Asset.objects.create(
            symbol="AUDZ", name="AUD Yield Probe", asset_type="stablecoin", decimals=2, is_active=True
        )
        AssetChainDeployment.objects.create(
            asset=asset,
            chain=operator.receiving_wallet_chain,
            contract_address="0x" + "9b" * 20,
            decimals=2,
            is_active=True,
        )
        operator.supported_settlement_assets.add(asset)
        return asset

    def _chain(self, answers):
        def balance_of(contract_name, contract_address, holder):
            answer = answers[contract_address]
            if isinstance(answer, Exception):
                raise answer
            return answer

        return patch.object(share_token_service, "_get_balance", side_effect=balance_of)

    def test_an_unknown_failure_reading_one_class_refuses_the_whole_answer(self):
        with (
            self._chain({self.tenant.deployed_token.contract_address: RuntimeError("node said no")}),
            self.assertRaises(WalletBalancesUnavailableException) as raised,
        ):
            self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertIn("The balance of DEP could not be read", str(raised.exception.detail))
        self.assertNotIn("node said no", str(raised.exception.detail))

    def test_a_node_that_cannot_be_reached_refuses_the_whole_answer(self):
        with (
            self._chain({self.tenant.deployed_token.contract_address: requests.ConnectionError("refused")}),
            self.assertRaises(WalletBalancesUnavailableException),
        ):
            self.service.get_wallet_token_balances(self.tenant.wallet.address)

    def test_the_operator_gets_the_failures_class_and_host_and_never_its_text(self):
        failure = requests.ConnectionError("Max retries exceeded with url: /v2/SECRET-KEY")
        failure.request = requests.Request("POST", "https://base.provider.example/v2/SECRET-KEY").prepare()
        with (
            self._chain({self.tenant.deployed_token.contract_address: failure}),
            self.assertLogs("tokens.services.share_token_service", level="ERROR") as logged,
            self.assertRaises(WalletBalancesUnavailableException),
        ):
            self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertIn("ConnectionError from base.provider.example", " ".join(logged.output))
        self.assertNotIn("SECRET-KEY", " ".join(logged.output))

    def _node(self, *, chain_id=None, code=b""):
        node = Mock()
        node.w3.eth.chain_id = settings.BLOCKCHAIN_CHAIN_ID if chain_id is None else chain_id
        node.w3.eth.get_code.side_effect = code if isinstance(code, Exception) else lambda address: code
        return patch.object(share_token_service, "get_base_chain_client", return_value=node)

    def _refused(self, failure, **node):
        readable = make_tenant("partial-readable").deployed_token
        answers = {self.tenant.deployed_token.contract_address: failure, readable.contract_address: 12}
        with (
            self._chain(answers),
            self._node(**node),
            self.assertRaises(WalletBalancesUnavailableException) as raised,
        ):
            self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertIn("The balance of DEP could not be read", str(raised.exception.detail))

    def test_a_class_with_no_code_on_the_configured_chain_is_left_out_and_the_rest_still_answer(self):
        readable = make_tenant("partial-readable").deployed_token
        answers = {
            self.tenant.deployed_token.contract_address: BadFunctionCallOutput("is contract deployed correctly"),
            readable.contract_address: 12,
        }
        with (
            self._chain(answers),
            self._node() as node,
            self.assertLogs("tokens.services.share_token_service", level="WARNING") as logged,
        ):
            result = self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertEqual([(row["token"], row["balance"]) for row in result["balances"]], [(str(readable.pk), "12")])
        node.return_value.w3.eth.get_code.assert_called_once_with(
            Web3.to_checksum_address(self.tenant.deployed_token.contract_address)
        )
        self.assertIn(f"DEP has no contract code at {self.tenant.deployed_token.contract_address}", logged.output[0])

    def test_no_return_data_from_a_node_on_another_chain_refuses(self):
        self._refused(BadFunctionCallOutput("is contract deployed correctly"), chain_id=8453)

    def test_no_return_data_from_a_class_that_has_code_refuses(self):
        self._refused(BadFunctionCallOutput("could not decode"), code=b"\x60\x80")

    def test_no_return_data_when_the_code_cannot_be_read_refuses(self):
        self._refused(BadFunctionCallOutput("is contract deployed correctly"), code=requests.ReadTimeout("slow"))

    def test_a_revert_refuses(self):
        self._refused(ContractLogicError("execution reverted"))

    def test_an_error_carrying_data_refuses(self):
        self._refused(ContractLogicError("execution reverted: limit exceeded", data={"see": "limits"}))

    def test_a_json_rpc_error_refuses(self):
        self._refused(Web3RPCError("internal error"))

    def test_a_request_that_times_out_refuses(self):
        self._refused(requests.ReadTimeout("the provider did not answer in time"))

    def test_a_settlement_asset_with_no_code_on_the_configured_chain_is_left_out_too(self):
        stablecoin = self._stablecoin()
        answers = {
            self.tenant.deployed_token.contract_address: 4,
            "0x" + "9b" * 20: BadFunctionCallOutput("is contract deployed correctly"),
        }
        with (
            self._chain(answers),
            self._node(),
            self.assertLogs("tokens.services.share_token_service", level="WARNING"),
        ):
            result = self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertEqual([(row["symbol"], row["balance"]) for row in result["balances"]], [("DEP", "4")])
        self.assertNotIn(str(stablecoin.pk), [row["token"] for row in result["balances"]])

    def test_an_unknown_failure_reading_the_settlement_asset_refuses_too(self):
        self._stablecoin()
        answers = {
            self.tenant.deployed_token.contract_address: 0,
            "0x" + "9b" * 20: RuntimeError("node said no"),
        }
        with self._chain(answers), self.assertRaises(WalletBalancesUnavailableException) as raised:
            self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertIn("AUDZ", str(raised.exception.detail))


CONFIGURED_CHAIN = 84532
ANOTHER_CHAIN = 8453
NO_CODE = {"result": "0x"}
SOME_CODE = {"result": "0x6080604052"}
EMPTY_RETURN = {"result": "0x"}


@override_settings(BLOCKCHAIN_CHAIN_ID=CONFIGURED_CHAIN)
class ANodeThatCannotAnswerIsNotReadAsAnEmptyWalletTest(APITestCase):

    def setUp(self):
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        self.tenant = make_tenant("scripted-node")
        self.client.force_authenticate(self.tenant.user)
        self.addCleanup(reset_chain_client)

    def balances(self, *, later=None, **answers):
        script = {"eth_chainId": {"result": hex(CONFIGURED_CHAIN)}, "eth_blockNumber": {"result": "0x10"}, **answers}
        with ScriptedNode(script) as node, override_settings(BLOCKCHAIN_RPC_URL=node.url):
            reset_chain_client()
            get_base_chain_client()
            node.answers.update(later or {})
            return self.client.get(BALANCES, {"wallet_address": self.tenant.wallet.address})

    def assert_refused(self, response):
        self.assertEqual(response.status_code, 503, response.content)
        self.assertIn("The balance of DEP could not be read", response.json()["detail"])

    def test_a_rate_limit_whose_error_carries_data_refuses(self):
        limited = {"code": -32005, "message": "limit exceeded", "data": {"see": "https://provider.example/limits"}}

        self.assert_refused(self.balances(eth_call={"error": limited}))

    def test_an_internal_error_whose_data_is_null_refuses(self):
        self.assert_refused(
            self.balances(eth_call={"error": {"code": -32603, "message": "internal error", "data": None}})
        )

    def test_a_revert_refuses(self):
        reverted = {"code": 3, "message": "execution reverted", "data": "0x" + "ab" * 4}

        self.assert_refused(self.balances(eth_call={"error": reverted}))

    def test_an_endpoint_that_now_serves_another_chain_refuses(self):
        response = self.balances(
            eth_call=EMPTY_RETURN, eth_getCode=NO_CODE, later={"eth_chainId": {"result": hex(ANOTHER_CHAIN)}}
        )

        self.assert_refused(response)

    def test_a_class_that_has_code_but_returned_nothing_refuses(self):
        self.assert_refused(self.balances(eth_call=EMPTY_RETURN, eth_getCode=SOME_CODE))

    def test_a_class_with_no_code_on_the_configured_chain_is_left_out(self):
        response = self.balances(eth_call=EMPTY_RETURN, eth_getCode=NO_CODE)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"walletAddress": self.tenant.wallet.address, "balances": []})
