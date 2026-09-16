import time
from unittest.mock import patch

from web3 import Web3

from integrations.base_chain.exceptions import BaseChainTransactionError
from tokens.constants import MAX_UINT256
from tokens.services.settlement_context import recorded_settlement_context
from tokens.tests.swap_state_fixtures import CONFIRMED, SELLER, swap_service


def approval_bytes(swap, key=SELLER, participant="seller", **changes):
    context = recorded_settlement_context(swap)
    spender = context["typed_data"]["domain"]["verifyingContract"]
    token = (
        context["share_token"]["address"] if participant == "seller" else context["payment_asset"]["deployment_address"]
    )
    transaction = {
        "to": token,
        "chainId": int(context["typed_data"]["domain"]["chainId"]),
        "value": 0,
        "data": "0x095ea7b3" + spender[2:].rjust(64, "0") + f"{MAX_UINT256:064x}",
        "gas": 50000,
        "gasPrice": 1,
        "nonce": 0,
        **changes,
    }
    return bytes(key.sign_transaction(transaction).raw_transaction)


class ApprovalLedger:
    def __init__(self, client):
        self.client = client
        self.mined_nonce = 0
        self.status = 1
        self.confirm = True
        self.lose_acknowledgement = False
        self.patient = False
        self.receipts = {}
        self.broadcasts = []
        client.send_raw_transaction.side_effect = self.send
        client.get_transaction_receipt.side_effect = self.receipts.get
        client.receipt_even_if_reverted.side_effect = self.wait
        client.w3.eth.get_transaction_count.side_effect = lambda address, block="latest": self.mined_nonce

    def send(self, raw):
        tx_hash = Web3.keccak(bytes(raw)).to_0x_hex()
        self.broadcasts.append(bytes(raw))
        if self.confirm:
            self.mine(tx_hash)
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic approval acknowledgement loss")
        return tx_hash

    def mine(self, tx_hash):
        self.receipts[tx_hash] = {**CONFIRMED, "status": self.status, "transactionHash": tx_hash}

    def wait(self, tx_hash, timeout=120):
        until = time.monotonic() + timeout
        while tx_hash not in self.receipts:
            if not self.patient or time.monotonic() > until:
                raise BaseChainTransactionError("Error waiting for receipt: synthetic timeout")
            time.sleep(0.01)
        return self.receipts[tx_hash]


def approval_node(test):
    client = swap_service(test).get_base_chain_client()
    test.enterContext(patch("tokens.services.approval_submissions.get_base_chain_client", return_value=client))
    return ApprovalLedger(client)
