import json
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from eth_abi import encode
from eth_account import Account
from eth_account._utils.legacy_transactions import Transaction as LegacyTransaction
from eth_account.messages import encode_typed_data
from eth_utils import event_abi_to_log_topic
from hexbytes import HexBytes
from web3 import Web3

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import (
    BLOCK_HASH,
    KEY,
    SENDER,
    chain_client,
    receipt,
)
from shared.tests.tenants import make_eligible, make_tenant
from tokens.models import TransferOrder, TransferOrderStatus, TransferOrderType
from tokens.services import atomic_swap_service
from tokens.tests.swap_state_fixtures import BUYER, SELLER
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

HEAD_HASH = "0x" + "cc" * 32
FINALIZED_HASH = "0x" + "dd" * 32
NEXT_NONCE = 7


def make_execution(label):
    seller = make_tenant(f"{label}-seller", with_swap=False)
    buyer = make_tenant(f"{label}-buyer", with_swap=False)
    make_eligible(seller)
    make_eligible(buyer)
    orders = []
    for tenant, key, kind in ((seller, SELLER, TransferOrderType.SELL), (buyer, BUYER, TransferOrderType.BUY)):
        wallet = Wallet.objects.create(
            user_account=tenant.account,
            address=key.address,
            chain="base",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )
        orders.append(
            TransferOrder.objects.create(
                token=seller.deployed_token,
                payment_asset=seller.refs.stablecoin,
                wallet=wallet,
                owner_account=tenant.account,
                wallet_address=wallet.address,
                order_type=kind,
                quantity=10,
                filled_quantity=10,
                price_per_share="1.50",
                status=TransferOrderStatus.PENDING_SIGNATURE,
            )
        )
    swap = atomic_swap_service.create_swap_order(*orders, share_amount=10)
    signable = encode_typed_data(full_message=atomic_swap_service.get_typed_data(swap))
    return SimpleNamespace(
        seller=seller,
        buyer=buyer,
        swap=swap,
        orders=orders,
        signatures={
            role: "0x" + key.sign_message(signable).signature.hex()
            for role, key in (("seller", SELLER), ("buyer", BUYER))
        },
    )


def execution_contract():
    abi = json.loads((Path(settings.BASE_DIR) / "contracts" / "AtomicSwap.json").read_text())["abi"]
    return Web3().eth.contract(abi=abi)


def execution_receipt(attempt, arguments, *, status=1, changes=None, block_number=12, block_hash=BLOCK_HASH):
    values = {
        "orderHash": arguments["settlement"]["digest"],
        **{key: arguments[key] for key in ("seller", "buyer", "shareToken", "paymentToken")},
        **{key: int(arguments[key]) for key in ("shareAmount", "paymentAmount", "nonce")},
        **(changes or {}),
    }
    event = execution_contract().events.SwapExecuted()
    log = {
        "address": Web3.to_checksum_address(attempt.operation.intent["to"]),
        "topics": [
            event_abi_to_log_topic(event.abi),
            HexBytes(values["orderHash"]),
            HexBytes(encode(["address"], [values["seller"]])),
            HexBytes(encode(["address"], [values["buyer"]])),
        ],
        "data": HexBytes(
            encode(
                ["address", "address", "uint256", "uint256", "uint256"],
                [values[key] for key in ("shareToken", "paymentToken", "shareAmount", "paymentAmount", "nonce")],
            )
        ),
        "logIndex": 0,
        "transactionIndex": 0,
        "transactionHash": HexBytes(attempt.tx_hash),
        "blockNumber": block_number,
        "blockHash": HexBytes(block_hash),
    }
    return receipt(attempt, status) | {
        "blockNumber": block_number,
        "blockHash": block_hash,
        "from": attempt.operation.intent["sender"],
        "to": attempt.operation.intent["to"],
        "logs": [log] if status else [],
    }


class ExecutionChain:
    def __init__(self, node):
        self.node = node

    @property
    def chain_id(self):
        self.node.probe("chain_id")
        return self.node.chain_id

    def get_block(self, identifier, full_transactions=False):
        return self.node.block(identifier, full_transactions)

    def get_transaction_count(self, address, identifier):
        return self.node.count(address, identifier)


class ExecutionNode:
    def __init__(self, arguments):
        self.arguments = arguments
        self.chain_id = settings.BLOCKCHAIN_CHAIN_ID
        self.probe = lambda label: None
        self.client = chain_client()
        self.client.w3 = SimpleNamespace(eth=ExecutionChain(self))
        self.client.assert_expected_chain.side_effect = self.expected_chain
        self.client.get_nonce.side_effect = lambda sender: self.value("nonce", NEXT_NONCE)
        self.client.estimate_gas.side_effect = lambda transaction: self.value("estimate", 600000)
        self.client.load_contract.side_effect = lambda name, address: execution_contract()
        self.client.send_raw_transaction.side_effect = self.send
        self.client.get_transaction_receipt.side_effect = self.observed
        self.confirmed = True
        self.status = 1
        self.lose_acknowledgement = False
        self.receipts = {}
        self.blocks = {}
        self.transactions = []
        self.broadcasts = []

    def value(self, label, result):
        self.probe(label)
        return result

    def expected_chain(self):
        return self.value("expected_chain", self.chain_id)

    def observed(self, tx_hash):
        return self.value("receipt", self.receipts.get(tx_hash))

    def block(self, identifier, full_transactions=False):
        block = self.value("block", self.blocks.get(identifier))
        if block is not None and full_transactions:
            block = {**block, "transactions": [tx for tx in self.transactions if tx["blockNumber"] == block["number"]]}
        return block

    def count(self, address, identifier):
        if address.casefold() != SENDER.casefold():
            return self.value("count", 0)
        mined = [tx for tx in self.transactions if identifier == "latest" or tx["blockNumber"] <= identifier]
        return self.value("count", NEXT_NONCE + len(mined))

    def replace(self, attempt, *, block_number=12, block_hash=BLOCK_HASH, **changes):
        fields = LegacyTransaction.from_bytes(bytes(attempt.raw_transaction)).as_dict()
        signed = Account.from_key(KEY).sign_transaction(
            {
                "chainId": self.chain_id,
                **{key: fields[key] for key in ("nonce", "gasPrice", "gas", "value", "data")},
                "to": Web3.to_checksum_address(fields["to"]),
                **changes,
            }
        )
        fields = LegacyTransaction.from_bytes(signed.raw_transaction).as_dict()
        sender = attempt.operation.intent["sender"]
        self.transactions.append(
            {
                **fields,
                "type": 0,
                "chainId": self.chain_id,
                "hash": signed.hash,
                "from": sender,
                "to": Web3.to_checksum_address(fields["to"]),
                "input": fields["data"],
                "blockHash": block_hash,
                "blockNumber": block_number,
                "transactionIndex": 0,
            }
        )
        self.receipts[signed.hash.to_0x_hex()] = {
            "transactionHash": signed.hash,
            "blockHash": block_hash,
            "blockNumber": block_number,
            "transactionIndex": 0,
            "from": sender,
            "to": Web3.to_checksum_address(fields["to"]),
            "status": 1,
            "gasUsed": 21000,
            "effectiveGasPrice": fields["gasPrice"],
        }
        return signed.hash.to_0x_hex()

    def advance(self, head, finalized=None):
        self.blocks = {}
        for mined in self.receipts.values():
            self.blocks[mined["blockNumber"]] = {"hash": mined["blockHash"], "number": mined["blockNumber"]}
        self.blocks["latest"] = self.blocks.setdefault(head, {"hash": HEAD_HASH, "number": head})
        if finalized is not None:
            self.blocks["finalized"] = self.blocks.setdefault(finalized, {"hash": FINALIZED_HASH, "number": finalized})

    def send(self, raw):
        self.probe("send")
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = execution_receipt(attempt, self.arguments, status=self.status)
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic swap acknowledgement loss")
        return tx_hash
