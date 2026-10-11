import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from django.conf import settings
from django.test import SimpleTestCase, override_settings

from integrations.base_chain.client import BaseChainClient


@override_settings(BLOCKCHAIN_CHAIN_ID=31337)
class ManualChainSmokeTest(SimpleTestCase):
    def test_local_factory_deployment_and_mint_match_the_owners_holding(self):
        endpoint = os.environ.get("CHAIN_TEST_RPC_URL", "")
        self.assertIn(urlparse(endpoint).hostname, {"127.0.0.1", "localhost"})
        self.assertEqual(endpoint, settings.BLOCKCHAIN_RPC_URL)
        chain = BaseChainClient()
        self.assertEqual(chain.chain_id, 31337)
        signer = settings.BLOCKCHAIN_OPERATOR_KEY
        owner = chain.get_address_from_private_key(signer)
        path = (
            Path(settings.BASE_DIR).parent
            / "contracts/artifacts/contracts/ShareTokenFactory.sol/ShareTokenFactory.json"
        )
        artifact = json.loads(path.read_text())
        constructor = chain.w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"]).constructor(owner)
        _, receipt = chain.send_transaction(constructor, signer)
        self.assertEqual(receipt["status"], 1)
        factory = chain.load_contract("ShareTokenFactory", receipt["contractAddress"])
        identifier = f"123456780:{uuid4().hex}"
        _, created = chain.send_transaction(
            factory.functions.createShareToken("Synthetic ordinary", "SMOKE", identifier, "123456780", 100, owner),
            signer,
        )
        self.assertEqual(created["status"], 1)
        token_address = factory.functions.getTokenByIdentifier(identifier).call()
        token = chain.load_contract("ShareToken", token_address)
        whitelist = chain.load_contract("WhitelistRegistry", token.functions.whitelist().call())
        expiry = chain.w3.eth.get_block("latest")["timestamp"] + 3600
        chain.send_transaction(whitelist.functions.setExpiry(owner, expiry), signer)
        _, minted = chain.send_transaction(token.functions.mint(owner, 10), signer)
        self.assertEqual(minted["status"], 1)
        self.assertEqual((token.functions.totalSupply().call(), token.functions.balanceOf(owner).call()), (10, 10))
