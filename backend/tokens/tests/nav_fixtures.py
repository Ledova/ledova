from unittest.mock import Mock, patch
from uuid import uuid4

from web3 import Web3

from assets.models import Asset
from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import (
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from shared.tests.tenants import make_tenant
from tokens.models import YieldToken
from tokens.services import nav


class NAVNode:
    def __init__(self, target):
        self.target = target.lower()
        self.client = chain_client()
        self.confirmed = True
        self.lose_acknowledgement = False
        self.receipt_status = 1
        self.receipts = {}
        self.broadcasts = []
        self.event_changes = {}
        self.event_count = 1
        self.contract = Mock()
        self.contract.functions.decimals.return_value.call.return_value = 6
        self.contract.functions.navUpdaters.return_value.call.return_value = True
        self.contract.events.NAVUpdated.return_value.process_receipt.side_effect = self.events
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("The legacy NAV sender must not run")

    def events(self, mined, **kwargs):
        attempt = SignedAttempt.objects.select_related("operation").get(tx_hash=mined["transactionHash"])
        data = attempt.operation.intent["data"]
        args = {"oldNav": 990000, "newNav": int(data[10:74], 16), "reserveValue": int(data[74:], 16), "timestamp": 100}
        return [{"address": self.target, "args": args | self.event_changes}] * self.event_count

    def receipt(self, attempt):
        return receipt(attempt, self.receipt_status) | {"from": SENDER, "to": self.target}

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = self.receipt(attempt)
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic NAV send acknowledgement loss")
        return tx_hash


def install_nav(test, *, submit=True):
    test.tenant = make_tenant("nav-owner")
    test.tenant.user.is_staff = True
    test.tenant.user.is_superuser = True
    test.tenant.user.save()
    test.token = YieldToken.objects.create(
        name="Synthetic NAV",
        symbol="AUSG",
        contract_address="0x" + "d" * 40,
        decimals=6,
        nav_per_token="1.02",
        total_reserve_value="100",
    )
    test.asset, _ = Asset.objects.update_or_create(
        symbol="AUSG", defaults={"name": "Synthetic NAV", "asset_type": "erc20_token"}
    )
    admitted_signer()
    test.node = NAVNode(test.token.contract_address)
    patcher = patch("tokens.services.nav_recovery.get_base_chain_client", return_value=test.node.client)
    patcher.start()
    test.addCleanup(patcher.stop)
    if submit:
        test.update = nav.submit(test.token, test.tenant.user, uuid4(), "1.25", "500", update_on_chain=True)
