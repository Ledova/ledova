from unittest.mock import patch

import requests
from django.test import TestCase
from rest_framework.test import APITestCase
from web3.exceptions import BadFunctionCallOutput, ContractLogicError

from assets.models import Asset, AssetChainDeployment
from feature_flags.models import FeatureFlag
from integrations.base_chain.exceptions import BaseChainConnectionError
from operators.models import Operator
from shared.tests.tenants import make_tenant
from tokens.exceptions import WalletBalancesUnavailableException
from tokens.services import share_token_service

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

    def test_the_operator_still_gets_what_the_caller_no_longer_does(self):
        with (
            self._chain({self.tenant.deployed_token.contract_address: RuntimeError("node said no")}),
            self.assertLogs("tokens.services.share_token_service", level="ERROR") as logged,
            self.assertRaises(WalletBalancesUnavailableException),
        ):
            self.service.get_wallet_token_balances(self.tenant.wallet.address)

        self.assertIn("node said no", " ".join(logged.output))

    def test_a_class_whose_contract_gives_no_balance_is_left_out_and_the_rest_still_answer(self):
        readable = make_tenant("partial-readable").deployed_token
        for refusal in (
            BadFunctionCallOutput("Could not transact with/call contract function, is contract deployed correctly"),
            ContractLogicError("execution reverted"),
        ):
            with self.subTest(refusal=type(refusal).__name__):
                answers = {self.tenant.deployed_token.contract_address: refusal, readable.contract_address: 12}
                with (
                    self._chain(answers),
                    self.assertLogs("tokens.services.share_token_service", level="WARNING") as logged,
                ):
                    result = self.service.get_wallet_token_balances(self.tenant.wallet.address)

                self.assertEqual(
                    [(row["token"], row["balance"]) for row in result["balances"]], [(str(readable.pk), "12")]
                )
                self.assertIn(f"DEP at {self.tenant.deployed_token.contract_address} gave no balance", logged.output[0])
                self.assertIn(type(refusal).__name__, logged.output[0])

    def test_a_settlement_asset_whose_contract_gives_no_balance_is_left_out_too(self):
        stablecoin = self._stablecoin()
        answers = {
            self.tenant.deployed_token.contract_address: 4,
            "0x" + "9b" * 20: BadFunctionCallOutput("Could not transact with/call contract function"),
        }
        with self._chain(answers), self.assertLogs("tokens.services.share_token_service", level="WARNING"):
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
