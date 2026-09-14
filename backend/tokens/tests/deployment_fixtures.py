from unittest.mock import Mock, patch

from hexbytes import HexBytes
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
from companies.models import Company, CompanyStatus
from shared.tests.tenants import make_tenant
from tokens.models import TokenDeployment
from tokens.services import deployment

FACTORY = "0x" + "f" * 40
CREATED = Web3.to_checksum_address("0x" + "c0ffee" + "0" * 34)


def deployment_token(name="deployment"):
    tenant = make_tenant(name)
    Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.ACTIVE)
    tenant.company.refresh_from_db()
    with patch("tokens.tasks.deploy_share_token_task.defer"):
        deployment.start_deployment(tenant.token, principal_id=tenant.user.pk)
    return tenant


class DeploymentNode:
    def __init__(self, *, confirmed=True):
        self.client = chain_client()
        self.receipts = {}
        self.broadcasts = []
        self.confirmed = confirmed
        self.lose_acknowledgement = False
        self.receipt_status = 1
        self.existing_address = "0x" + "0" * 40
        self.event_changes = {}
        self.events_missing = False
        self.contract = Mock()
        self.contract.functions.getTokenByIdentifier.return_value.call.side_effect = lambda: self.existing_address
        self.contract.events.ShareTokenCreated.return_value.process_receipt.side_effect = self.events
        self.client.load_contract.return_value = self.contract
        self.client.get_transaction_receipt.side_effect = self.receipts.get
        self.client.send_raw_transaction.side_effect = self.send
        self.client.is_valid_address.side_effect = Web3.is_address
        self.client.to_checksum_address.side_effect = Web3.to_checksum_address
        self.client.send_transaction.side_effect = AssertionError("The legacy deployment sender must not run")

    def events(self, mined, **kwargs):
        if self.events_missing:
            return []
        attempt = SignedAttempt.objects.get(tx_hash=Web3.to_hex(HexBytes(mined["transactionHash"])))
        intent = TokenDeployment.objects.get(operation=attempt.operation).intent
        event = {
            "address": FACTORY,
            "args": {
                "tokenAddress": CREATED,
                "identifier": intent["identifier"],
                "symbol": intent["symbol"],
                "authorizedShares": int(intent["authorized_shares"]),
            },
        }
        event["args"].update(self.event_changes)
        return [event]

    def send(self, raw):
        tx_hash = Web3.to_hex(Web3.keccak(bytes(raw)))
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        self.broadcasts.append(bytes(raw))
        if self.confirmed:
            self.receipts[tx_hash] = receipt(attempt, self.receipt_status)
            if self.receipt_status == 1:
                self.existing_address = CREATED
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


__all__ = ["CHAIN_ID", "KEY", "SENDER", "FACTORY", "CREATED", "DeploymentNode", "admitted_signer", "deployment_token"]


def install_deployment(test):
    test.tenant = deployment_token()
    test.token = test.tenant.token
    test.node = DeploymentNode()
    for target in (
        "tokens.services.deployment.get_base_chain_client",
        "tokens.services.share_token_service.get_base_chain_client",
    ):
        patcher = patch(target, return_value=test.node.client)
        patcher.start()
        test.addCleanup(patcher.stop)
    patcher = patch("tokens.services.share_token_service._approve_for_swap")
    test.approval = patcher.start()
    test.addCleanup(patcher.stop)
    admitted_signer()
