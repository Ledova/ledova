from unittest.mock import Mock, patch
from uuid import uuid4

from web3 import Web3

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import (
    BLOCK_HASH,
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from shared.tests.tenants import make_tenant
from tokens.services import pause_changes


class PauseNode:
    def __init__(self, target):
        self.target = target.lower()
        self.client = chain_client()
        self.client.get_block.return_value = {"number": 11, "hash": BLOCK_HASH}
        self.client.get_block.side_effect = lambda identifier="latest": (
            {"number": 12, "hash": BLOCK_HASH} if identifier == 12 else self.client.get_block.return_value
        )
        self.paused = False
        self.confirmed = True
        self.lose_acknowledgement = False
        self.receipt_status = 1
        self.receipts = {}
        self.broadcasts = []
        self.event_changes = {}
        self.event_count = 1
        self.contract = Mock()
        self.contract.functions.paused.return_value.call.side_effect = lambda **kwargs: self.paused
        self.contract.events.Paused.return_value.process_receipt.side_effect = self.events
        self.contract.events.Unpaused.return_value.process_receipt.side_effect = self.events
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("The legacy pause sender must not run")

    def events(self, mined, **kwargs):
        return [{"address": self.target, "args": {"account": SENDER} | self.event_changes}] * self.event_count

    def receipt(self, attempt):
        return receipt(attempt, self.receipt_status) | {"from": SENDER, "to": self.target}

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.select_related("operation").get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = self.receipt(attempt)
            if self.receipt_status == 1:
                self.paused = attempt.operation.intent["data"] == "0x8456cb59"
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic pause send acknowledgement loss")
        return tx_hash


def install_pause(test):
    test.tenant = make_tenant("pause-owner")
    test.token = test.tenant.deployed_token
    admitted_signer()
    test.node = PauseNode(test.token.contract_address)
    patcher = patch("tokens.services.pause_recovery.get_base_chain_client", return_value=test.node.client)
    patcher.start()
    test.addCleanup(patcher.stop)
    test.change = pause_changes.submit(test.token, test.tenant.user, uuid4(), True)
