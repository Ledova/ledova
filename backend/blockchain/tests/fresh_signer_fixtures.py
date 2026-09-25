import json
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch

import rlp
from django.test import override_settings
from eth_account import Account
from web3 import Web3

from integrations.base_chain.client import BaseChainClient

KEY = "0x" + "11" * 32
SENDER = Account.from_key(KEY).address
CHAIN_ID = 84532
NAMES = {"share_token_factory": "ShareTokenFactory", "stablecoin": "AUDY", "atomic_swap": "AtomicSwap"}
CONSTRUCTOR = {"type": "constructor", "inputs": [{"name": "owner", "type": "address"}], "stateMutability": "nonpayable"}
ABI = [
    CONSTRUCTOR,
    {
        "type": "function",
        "name": "addMinter",
        "inputs": [{"name": "minter", "type": "address"}],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "type": "function",
        "name": "setPaymentTokenApproval",
        "inputs": [{"name": "token", "type": "address"}, {"name": "approved", "type": "bool"}],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
]


def manifest_fixture():
    addresses = {
        key: Web3.to_checksum_address(Web3.keccak(rlp.encode([bytes.fromhex(SENDER[2:]), nonce]))[-20:])
        for key, nonce in (("share_token_factory", 0), ("stablecoin", 1), ("atomic_swap", 3))
    }
    return {
        "version": 1,
        "chain_id": CHAIN_ID,
        "operator_address": SENDER,
        "environment_id": "synthetic-isolated-environment",
        "authorization_reference": "synthetic-test-authorization",
        "attestations": {"fresh_key": True, "isolated_environment": True, "producers_stopped": True},
        "contracts": addresses,
        "transactions": ["0x" + format(nonce + 1, "064x") for nonce in range(5)],
    }


def write_artifacts(directory):
    artifacts = Path(directory) / "contracts" / "artifacts"
    build_directory = artifacts / "build-info"
    build_directory.mkdir(parents=True)
    for index, name in enumerate(NAMES.values()):
        source = f"contracts/{name}.sol"
        contract_directory = artifacts / source
        contract_directory.mkdir(parents=True)
        bytecode, runtime = f"600{index}600055", f"600{index}6000"
        artifact = {
            "contractName": name,
            "sourceName": source,
            "abi": ABI,
            "bytecode": "0x" + bytecode,
            "deployedBytecode": "0x" + runtime,
        }
        output = {
            "abi": ABI,
            "evm": {
                "bytecode": {"object": bytecode, "linkReferences": {}},
                "deployedBytecode": {"object": runtime, "linkReferences": {}, "immutableReferences": {}},
            },
        }
        build = {
            "id": name,
            "solcLongVersion": "synthetic-compiler",
            "input": {"sources": {source: {"content": "synthetic"}}},
            "output": {"contracts": {source: {name: output}}},
        }
        (contract_directory / f"{name}.json").write_text(json.dumps(artifact))
        (contract_directory / f"{name}.dbg.json").write_text(json.dumps({"buildInfo": f"../../build-info/{name}.json"}))
        (build_directory / f"{name}.json").write_text(json.dumps(build))
    return Path(directory) / "backend"


def chain_fixture(manifest):
    chain = Mock(spec=BaseChainClient)
    chain.assert_expected_chain.return_value = CHAIN_ID
    chain.w3.eth.chain_id = CHAIN_ID
    chain.w3.eth.get_transaction_count.return_value = 5
    provider = Web3()
    contracts = manifest["contracts"]
    transaction_data = {}
    runtimes = {}
    for index, (key, nonce) in enumerate((("share_token_factory", 0), ("stablecoin", 1), ("atomic_swap", 3))):
        contract = provider.eth.contract(abi=ABI, bytecode=f"0x600{index}600055")
        transaction_data[nonce] = (None, contract.constructor(SENDER).data_in_transaction, contracts[key])
        runtimes[contracts[key].lower()] = bytes.fromhex(f"600{index}6000")
    encoder = provider.eth.contract(abi=ABI)
    transaction_data[2] = (contracts["stablecoin"], encoder.encode_abi("addMinter", args=[SENDER]), None)
    transaction_data[4] = (
        contracts["atomic_swap"],
        encoder.encode_abi("setPaymentTokenApproval", args=[contracts["stablecoin"], True]),
        None,
    )
    transactions, receipts = {}, {}
    blocks = {
        height: {"number": height, "hash": "0x" + format(height + 100, "064x"), "timestamp": 1700000000 + height}
        for height in range(1, 11)
    }
    for nonce, tx_hash in enumerate(manifest["transactions"]):
        to, data, address = transaction_data[nonce]
        transactions[tx_hash] = {
            "hash": tx_hash,
            "chainId": CHAIN_ID,
            "nonce": nonce,
            "value": 0,
            "from": SENDER,
            "to": to,
            "input": data,
        }
        receipts[tx_hash] = {
            "transactionHash": tx_hash,
            "blockHash": blocks[nonce + 1]["hash"],
            "blockNumber": nonce + 1,
            "transactionIndex": 0,
            "status": 1,
            "from": SENDER,
            "to": to,
            "contractAddress": address,
            "gasUsed": 21000,
            "effectiveGasPrice": 1000,
        }

    def block(identifier):
        if identifier in ("latest", "finalized"):
            return deepcopy(blocks[10])
        if isinstance(identifier, str):
            return deepcopy(next(block for block in blocks.values() if block["hash"] == identifier))
        return deepcopy(blocks[identifier])

    chain.w3.eth.get_block.side_effect = block
    chain.get_transaction.side_effect = lambda tx_hash: deepcopy(transactions[tx_hash])
    chain.get_transaction_receipt.side_effect = lambda tx_hash: deepcopy(receipts[tx_hash])
    chain.w3.eth.get_code.side_effect = lambda address: runtimes[address.lower()]
    deployed = {}
    for address in contracts.values():
        contract = Mock()
        contract.functions.owner.return_value.call.return_value = SENDER
        contract.functions.minters.return_value.call.return_value = True
        contract.functions.relayers.return_value.call.return_value = True
        contract.functions.approvedPaymentTokens.return_value.call.return_value = True
        deployed[address.lower()] = contract
    chain.w3.eth.contract.side_effect = lambda *, address, abi: deployed[address.lower()]
    return chain, transactions, receipts, blocks, deployed


class FreshSignerFixture:
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="fresh-signer-")
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.manifest = manifest_fixture()
        self.chain, self.transactions, self.receipts, self.blocks, self.contracts = chain_fixture(self.manifest)
        settings = override_settings(
            BASE_DIR=write_artifacts(self.directory),
            BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
            BLOCKCHAIN_OPERATOR_KEY=KEY,
            SHARE_TOKEN_FACTORY_ADDRESS=self.manifest["contracts"]["share_token_factory"],
            STABLECOIN_CONTRACT_ADDRESS=self.manifest["contracts"]["stablecoin"],
            ATOMIC_SWAP_ADDRESS=self.manifest["contracts"]["atomic_swap"],
            WALLET_CHAIN_FINALITY_POLICIES={"evm:84532": {"mode": "finalized"}},
        )
        settings.enable()
        self.addCleanup(settings.disable)
        patched = patch("blockchain.services.fresh_signer.get_base_chain_client", return_value=self.chain)
        patched.start()
        self.addCleanup(patched.stop)
