from unittest.mock import Mock

from django.contrib.auth import get_user_model
from web3 import Web3

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import (
    CHAIN_ID,
    KEY,
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from shared.tests.tenants import an_account
from wallets.models import Wallet
from whitelist.models import WhitelistEntry

ADDRESS = "0x" + "a" * 40
REGISTRY = "0x" + "d" * 40


def change_actor():
    return get_user_model().objects.create_superuser(email="whitelist-operator@example.test", password="synthetic")


def change_entry():
    wallet = Wallet.objects.create(user_account=an_account("whitelist-change"), address=ADDRESS, chain="base")
    return WhitelistEntry.objects.create(wallet=wallet)


class WhitelistNode:
    def __init__(self, *, confirmed=True):
        self.client = chain_client()
        self.receipts = {}
        self.broadcasts = []
        self.members = set()
        self.confirmed = confirmed
        self.lose_acknowledgement = False
        self.receipt_status = 1
        self.contract = Mock()
        self.contract.functions.isWhitelisted.return_value.call.side_effect = lambda: ADDRESS in self.members
        self.contract.functions.getInvestorInfo.return_value.call.side_effect = lambda: (ADDRESS in self.members, 0)
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("The legacy whitelist sender must not run")

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = receipt(attempt, self.receipt_status)
            if self.receipt_status == 1:
                data = attempt.operation.intent["data"]
                address = "0x" + data[-40:]
                if data.startswith("0xe43252d7"):
                    self.members.add(address)
                else:
                    self.members.discard(address)
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


__all__ = [
    "ADDRESS",
    "REGISTRY",
    "CHAIN_ID",
    "KEY",
    "SENDER",
    "admitted_signer",
    "change_actor",
    "change_entry",
    "WhitelistNode",
]
