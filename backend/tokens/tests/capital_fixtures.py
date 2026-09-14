from unittest.mock import Mock, patch

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
from shared.tests.tenants import make_tenant
from tokens.models import CapitalIncreaseExecution
from tokens.services import capital_execution
from tokens.services.capital_increase import submit_capital_increase


def capital_request(name="capital"):
    tenant = make_tenant(name)
    actor = get_user_model().objects.create_superuser(email=f"{name}-operator@example.test", password="synthetic")
    request = tenant.capital_increase
    submit_capital_increase(request, tenant.user)
    request.approve(actor)
    return tenant, actor


class CapitalNode:
    def __init__(self, *, cap=1000, confirmed=True):
        self.client = chain_client()
        self.cap = cap
        self.confirmed = confirmed
        self.receipt_status = 1
        self.lose_acknowledgement = False
        self.event_changes = {}
        self.events_missing = False
        self.broadcasts = []
        self.receipts = {}
        self.contract = Mock()
        self.contract.functions.authorizedShares.return_value.call.side_effect = lambda: self.cap
        self.contract.events.AuthorizedSharesUpdated.return_value.process_receipt.side_effect = self.events
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.send_transaction.side_effect = AssertionError("Capital must use its durable signed transaction")

    def events(self, mined, **kwargs):
        if self.events_missing:
            return []
        return [{"address": mined["to"], "args": {"oldAmount": 1000, "newAmount": 1100} | self.event_changes}]

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        execution = CapitalIncreaseExecution.objects.get(operation=attempt.operation)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = receipt(attempt, self.receipt_status) | {
                "to": execution.intent["to"],
                "from": execution.intent["sender"],
            }
            if self.receipt_status == 1:
                self.cap = int(execution.intent["new_authorized_total"])
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


def install_capital(test):
    test.tenant, test.actor = capital_request()
    test.request = test.tenant.capital_increase
    test.token = test.request.token
    test.node = CapitalNode()
    patcher = patch("tokens.services.capital_execution.get_base_chain_client", return_value=test.node.client)
    patcher.start()
    test.addCleanup(patcher.stop)
    admitted_signer()


def admit(request, actor, *, confirmed=None):
    with patch("tokens.tasks.execute_review_request_task.defer"):
        return capital_execution.admit(
            request, actor, confirmed=confirmed or capital_execution.confirmation(request, actor)
        )


__all__ = ["CHAIN_ID", "KEY", "SENDER", "CapitalNode", "admit", "capital_request", "install_capital"]
