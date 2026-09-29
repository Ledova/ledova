from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from integrations.base_chain.client import BaseChainClient
from integrations.base_chain.exceptions import GasEstimationError

RECIPIENT = "0x" + "d" * 40
SENDER = "0x" + "a" * 40


def client_whose_estimate(behaviour) -> BaseChainClient:
    client = object.__new__(BaseChainClient)
    client._web3 = SimpleNamespace(
        eth=SimpleNamespace(estimate_gas=behaviour),
        to_checksum_address=lambda address: address,
    )
    return client


class TheNodeIsAskedWhetherATransactionWorksTest(SimpleTestCase):

    def tearDown(self):
        BaseChainClient._web3 = None

    def test_an_estimate_the_node_refuses_is_not_replaced_with_a_guess(self):
        client = client_whose_estimate(Mock(side_effect=ValueError("execution reverted")))

        with self.assertRaises(GasEstimationError):
            client.estimate_gas({"to": RECIPIENT})

    def test_the_estimate_carries_headroom_over_what_the_node_said(self):
        client = client_whose_estimate(Mock(return_value=100_000))

        self.assertEqual(client.estimate_gas({"to": RECIPIENT}), 120_000)

    def test_a_caller_that_states_its_own_limit_does_not_ask_the_node(self):
        estimate = Mock(side_effect=AssertionError("the node must not be asked"))
        client = client_whose_estimate(estimate)
        client.get_nonce = Mock(return_value=1)
        function = Mock()
        function.build_transaction.return_value = {}

        with patch.object(BaseChainClient, "chain_id", 84532), patch.object(BaseChainClient, "gas_price", 1):
            built = client.build_transaction(function, from_address=SENDER, gas=250_000)

        self.assertEqual(built["gas"], 250_000)
        estimate.assert_not_called()
