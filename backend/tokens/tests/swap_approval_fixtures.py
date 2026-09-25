from unittest.mock import Mock, patch

from web3 import Web3

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import BLOCK_HASH, chain_client, receipt
from tokens.models import TokenDeployment
from tokens.services import deployment
from tokens.tests.deployment_fixtures import CREATED, SENDER, install_deployment

SWAP = "0x" + "d" * 40


def approval_receipt(attempt, status=1):
    return receipt(attempt, status) | {"from": SENDER, "to": SWAP}


class ApprovalNode:
    def __init__(self):
        self.client = chain_client()
        self.client.get_block.return_value = {"number": 11, "hash": BLOCK_HASH}
        self.client.get_block.side_effect = lambda identifier="latest": (
            {"number": 12, "hash": BLOCK_HASH} if identifier == 12 else self.client.get_block.return_value
        )
        self.approved = False
        self.confirmed = True
        self.lose_acknowledgement = False
        self.receipt_status = 1
        self.receipts = {}
        self.broadcasts = []
        self.event_changes = {}
        self.event_count = 1
        self.event_address = SWAP
        self.contract = Mock()
        self.contract.functions.approvedShareTokens.return_value.call.side_effect = lambda **kwargs: self.approved
        self.contract.events.ShareTokenApproved.return_value.process_receipt.side_effect = self.events
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("The legacy approval sender must not run")

    def events(self, mined, **kwargs):
        return [
            {"address": self.event_address, "args": {"token": CREATED, "approved": True} | self.event_changes}
        ] * self.event_count

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = approval_receipt(attempt, self.receipt_status)
            self.approved = self.receipt_status == 1
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic approval acknowledgement loss")
        return tx_hash


def install_approval(test):
    install_deployment(test)
    deployment.deploy_token(test.token)
    test.command = TokenDeployment.objects.get(pk=test.token.deployment_id)
    test.approval_node = ApprovalNode()
    patcher = patch("tokens.services.swap_approval.get_base_chain_client", return_value=test.approval_node.client)
    patcher.start()
    test.addCleanup(patcher.stop)
