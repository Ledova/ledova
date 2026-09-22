import itertools
from unittest.mock import Mock

from django.contrib.auth import get_user_model
from django.utils import timezone
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
from companies.models import Company, CompanyType
from shared.tests.tenants import a_profile, an_account, an_acn
from wallets.models import Wallet
from whitelist.constants import WHITELIST_NO_EXPIRY
from whitelist.models import WhitelistEntry

ADDRESS = "0x" + "a" * 40
REGISTRY = "0x" + "d" * 40
FACTORY = "0x" + "c" * 40
SET_EXPIRY = "0xe0468dcd"
_companies = itertools.count(71000000)


def change_actor():
    return get_user_model().objects.create_superuser(email="whitelist-operator@example.test", password="synthetic")


def change_entry():
    wallet = Wallet.objects.create(user_account=an_account("whitelist-change"), address=ADDRESS, chain="base")
    return WhitelistEntry.objects.create(wallet=wallet)


def change_company(label="whitelist-change"):
    return Company.objects.create(
        owner=a_profile(label).user,
        name=f"{label} Pty Ltd",
        company_type=CompanyType.PROPRIETARY,
        acn=an_acn(next(_companies)),
    )


class WhitelistNode:
    def __init__(self, *, confirmed=True):
        self.client = chain_client()
        self.receipts = {}
        self.broadcasts = []
        self.expiries = {}
        self.registry = Web3.to_checksum_address(REGISTRY)
        self.confirmed = confirmed
        self.lose_acknowledgement = False
        self.receipt_status = 1
        self.contract = Mock()
        self.contract.functions.expiresAt.return_value.call.side_effect = lambda: self.expiries.get(ADDRESS, 0)
        self.contract.functions.isWhitelisted.return_value.call.side_effect = self.listed
        self.contract.functions.registryOf.return_value.call.side_effect = lambda: self.registry
        self.contract.functions.whitelist.return_value.call.side_effect = lambda: self.registry
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("The legacy whitelist sender must not run")

    def listed(self):
        return self.expiries.get(ADDRESS, 0) > int(timezone.now().timestamp())

    def approve(self, expiry=WHITELIST_NO_EXPIRY):
        self.expiries[ADDRESS] = expiry

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = receipt(attempt, self.receipt_status)
            if self.receipt_status == 1:
                data = attempt.operation.intent["data"]
                assert data.startswith(SET_EXPIRY)
                self.expiries["0x" + data[34:74]] = int(data[74:], 16)
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


__all__ = [
    "ADDRESS",
    "REGISTRY",
    "FACTORY",
    "CHAIN_ID",
    "KEY",
    "SENDER",
    "admitted_signer",
    "change_actor",
    "change_company",
    "change_entry",
    "WhitelistNode",
]
