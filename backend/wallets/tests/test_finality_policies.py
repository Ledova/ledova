from django.test import SimpleTestCase, override_settings

from ledova_backend.chain_safety import BITCOIN_TEST_GENESIS
from shared.constants import BLOCKCHAIN_BITCOIN
from wallets.services.bitcoin_intent import GENESIS_HASHES
from wallets.services.chain_observations import finality_policy

BITCOIN_TEST = f"bitcoin:{BITCOIN_TEST_GENESIS}"
BITCOIN_REGTEST = f"bitcoin:{GENESIS_HASHES['regtest']}"
UNCONFIGURED = {"version": 1, "mode": "unconfigured"}


class ApprovedFinalityPolicyTest(SimpleTestCase):
    def test_the_admitted_public_evm_testnets_require_a_finalized_head(self):
        for network, chain in (("evm:84532", "base"), ("evm:11155111", "ethereum")):
            with self.subTest(network=network):
                self.assertEqual(finality_policy(network, chain), {"version": 1, "mode": "finalized"})

    def test_the_admitted_bitcoin_test_network_requires_six_inclusive_confirmations(self):
        self.assertEqual(finality_policy(BITCOIN_TEST, BLOCKCHAIN_BITCOIN), {"version": 1, "mode": "depth", "depth": 6})

    def test_synthetic_and_unlisted_networks_stay_unconfigured(self):
        for network, chain in (
            (BITCOIN_REGTEST, BLOCKCHAIN_BITCOIN),
            ("evm:1337", "base"),
            ("evm:31337", "base"),
        ):
            with self.subTest(network=network):
                self.assertEqual(finality_policy(network, chain), UNCONFIGURED)

    def test_an_exact_identity_cannot_inherit_another_networks_policy(self):
        for network in (
            "evm:8453",
            "evm:845321",
            "evm:1",
            "evm:11155112",
            "evm:84532 ",
            "EVM:84532",
            f"bitcoin:{BITCOIN_TEST_GENESIS[:-1]}0",
            f"bitcoin:{BITCOIN_TEST_GENESIS.upper()}",
            "bitcoin:",
            "84532",
        ):
            with self.subTest(network=network):
                chain = BLOCKCHAIN_BITCOIN if network.startswith("bitcoin") else "base"
                self.assertEqual(finality_policy(network, chain), UNCONFIGURED)

    def test_bitcoin_cannot_take_a_finalized_head_policy(self):
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES={BITCOIN_TEST: {"mode": "finalized"}}):
            self.assertEqual(finality_policy(BITCOIN_TEST, BLOCKCHAIN_BITCOIN), {"version": 1, "mode": "invalid"})

    def test_a_malformed_depth_is_refused_rather_than_softened(self):
        for policy in ({"mode": "depth"}, {"mode": "depth", "depth": 0}, {"mode": "depth", "depth": True}):
            with self.subTest(policy=policy), override_settings(WALLET_CHAIN_FINALITY_POLICIES={BITCOIN_TEST: policy}):
                self.assertEqual(finality_policy(BITCOIN_TEST, BLOCKCHAIN_BITCOIN), {"version": 1, "mode": "invalid"})
