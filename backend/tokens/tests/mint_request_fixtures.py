from datetime import date
from unittest.mock import Mock

from eth_account import Account
from web3 import Web3

from assets.models import Asset, AssetChainDeployment
from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import (
    CHAIN_ID,
    KEY,
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from operators.models import Operator
from tokens.models import MintRequest

RECIPIENT = "0x" + "a" * 40
TARGET = "0x" + "1" * 40


def settlement_asset():
    asset = Asset.objects.create(name="Synthetic dollar", symbol="AUDY", asset_type="stablecoin", decimals=2)
    AssetChainDeployment.objects.create(asset=asset, chain="base", contract_address=TARGET, decimals=2)
    Operator.get().supported_settlement_assets.add(asset)
    return asset


def mint_request(actor, **changes):
    values = {
        "settlement_asset": settlement_asset(),
        "recipient_address": RECIPIENT,
        "recipient_name": "Alice",
        "amount": 10000,
        "deposit_reference": "SYNTHETIC-1",
        "deposit_date": date(2026, 9, 1),
        "requested_by": actor,
    }
    values.update(changes)
    return MintRequest.objects.create(**values)


class MintNode:
    def __init__(self, *, confirmed=True):
        self.client = chain_client()
        self.receipts = {}
        self.broadcasts = []
        self.confirmed = confirmed
        self.lose_acknowledgement = False
        self.receipt_status = 1
        contract = Mock()
        contract.functions.minters.return_value.call.return_value = True
        contract.functions.totalSupply.return_value.call.return_value = 123456
        self.client.load_contract.return_value = contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.is_valid_address.side_effect = Web3.is_address
        self.client.to_checksum_address.side_effect = Web3.to_checksum_address
        self.client.account_from_key.side_effect = Account.from_key
        self.client.send_transaction.side_effect = AssertionError("The legacy mint sender must not run")

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = receipt(attempt, self.receipt_status)
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


__all__ = [
    "CHAIN_ID",
    "KEY",
    "SENDER",
    "RECIPIENT",
    "TARGET",
    "MintNode",
    "admitted_signer",
    "mint_request",
    "settlement_asset",
]
