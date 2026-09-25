from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from hexbytes import HexBytes
from web3 import Web3

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import (
    BLOCK_HASH,
    CHAIN_ID,
    KEY,
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from shared.tests.tenants import make_tenant
from tokens.models import ShareIssuanceExecution, ShareIssuanceRequest
from tokens.services import issuance_execution

FINALITY_POLICIES = {f"evm:{CHAIN_ID}": {"mode": "finalized"}}


def issuance_request(name="issuance"):
    tenant = make_tenant(name)
    actor = get_user_model().objects.create_superuser(email=f"{name}-operator@example.test", password="synthetic")
    request = ShareIssuanceRequest.objects.create(
        token=tenant.deployed_token, recipient_address=tenant.wallet.address, amount=10, reason="Allotment"
    )
    tenant.issuance_request = request
    request.approve(actor)
    return tenant, actor


class IssuanceNode:
    def __init__(self, *, confirmed=True):
        self.client = chain_client()
        self.confirmed = confirmed
        self.receipt_status = 1
        self.lose_acknowledgement = False
        self.event_changes = {}
        self.events_missing = False
        self.broadcasts = []
        self.receipts = {}
        self.head = 12
        self.finalized = 12
        self.block_hashes = {12: BLOCK_HASH}
        self.client.w3 = Mock()
        self.client.w3.eth.chain_id = CHAIN_ID
        self.client.w3.eth.get_block.side_effect = self.block
        self.client.get_block.side_effect = self.block
        self.contract = Mock()
        self.contract.functions.authorizedShares.return_value.call.return_value = 1000
        self.contract.functions.totalSupply.return_value.call.return_value = 0
        self.contract.functions.paused.return_value.call.return_value = False
        self.contract.events.Transfer.return_value.process_receipt.side_effect = self.events
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("Issuance must use its durable signed transaction")

    def block(self, identifier):
        height = self.head if identifier == "latest" else self.finalized if identifier == "finalized" else identifier
        if isinstance(height, str):
            height = next(number for number, block_hash in self.block_hashes.items() if block_hash == identifier)
        return {
            "number": height,
            "hash": self.block_hashes.get(height, "0x" + f"{height:064x}"),
            "timestamp": 1700000000 + height,
        }

    def events(self, mined, **kwargs):
        if self.events_missing:
            return []
        execution = ShareIssuanceExecution.objects.get(
            transaction__tx_hash=Web3.to_hex(HexBytes(mined["transactionHash"]))
        )
        return [
            {
                "address": mined["to"],
                "args": {
                    "from": "0x" + "00" * 20,
                    "to": execution.intent["recipient"],
                    "value": int(execution.intent["amount"]),
                }
                | self.event_changes,
            }
        ]

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        execution = ShareIssuanceExecution.objects.get(operation=attempt.operation)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = receipt(attempt, self.receipt_status) | {
                "to": execution.intent["to"],
                "from": execution.intent["sender"],
            }
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


def install_issuance(test):
    test.enterContext(override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES))
    test.tenant, test.actor = issuance_request()
    test.request = test.tenant.issuance_request
    test.token = test.request.token
    test.node = IssuanceNode()
    for target, value in (
        ("tokens.services.issuance_execution.get_base_chain_client", test.node.client),
        ("tokens.services.share_token_service.is_recipient_whitelisted", True),
    ):
        patcher = patch(target, return_value=value)
        patcher.start()
        test.addCleanup(patcher.stop)
    admitted_signer()


def admit(request, actor, *, confirmed=None):
    with patch("tokens.tasks.execute_review_request_task.defer"):
        return issuance_execution.admit(
            request, actor, confirmed=confirmed or issuance_execution.confirmation(request, actor)
        )


__all__ = [
    "CHAIN_ID",
    "FINALITY_POLICIES",
    "KEY",
    "SENDER",
    "IssuanceNode",
    "admit",
    "issuance_request",
    "install_issuance",
]
