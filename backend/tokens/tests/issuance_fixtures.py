from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from hexbytes import HexBytes
from web3 import Web3

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.tests.outgoing_fixtures import (
    BLOCK_HASH,
    CHAIN_ID,
    KEY,
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from shared.db import use_migrate, use_operator
from shared.tests.tenants import make_tenant
from tokens.models import ShareIssuance, ShareIssuanceExecution, ShareIssuanceRequest
from tokens.services import issuance_execution

FINALITY_POLICIES = {f"evm:{CHAIN_ID}": {"mode": "finalized"}}


def issuance_request(name="historical-issuance", *, signed=False):
    from blockchain.services import outgoing
    from shared.tests.schema import migrate_to, restore_every_migration

    tenant = make_tenant(name)
    actor = get_user_model().objects.create_superuser(email=f"{name}-operator@example.test", password="synthetic")
    try:
        historical = migrate_to([("tokens", "0099_company_register_deployment_guards")])
        request = ShareIssuanceRequest.objects.create(
            token=tenant.deployed_token, recipient_address=tenant.wallet.address, amount=10, reason="Allotment"
        )
        request.approve(actor)
        intent = issuance_execution._intent(request, tenant.deployed_token)
        command = historical.get_model("tokens", "ShareIssuanceExecution").objects.create(
            uuid=request.dispatch_id,
            request_id=request.pk,
            token_id=request.token_id,
            company_id=request.company_id,
            executed_by_id=actor.pk,
            authority=issuance_execution.REQUEST_AUTHORITY,
            intent=intent,
        )
        if signed:
            admitted_signer()
            issuance = ShareIssuance.objects.create(
                token=request.token,
                recipient_address=intent["recipient"],
                amount=intent["amount"],
                issuance_type=request.issuance_type,
                reason=f"Issuance request: {request.reason}",
                initiated_by=actor,
                idempotency_key=f"issuance-request:{request.pk}",
            )
            command.issuance_id = issuance.pk
            command.status = "executing"
            command.save(update_fields=["issuance_id", "status", "updated_at"])
            request.mark_executing()
            fields = {field: intent[field] for field in issuance_execution.INTENT_FIELDS}
            fields["value"] = int(fields["value"])
            claim = outgoing.open_operation(f"share-issuance:{request.pk}:{command.pk}", **fields)
            command.operation_id = claim.operation_id
            command.save(update_fields=["operation", "updated_at"])
            prepared = outgoing.prepare_operation(claim, chain_client())

            def retain(attempt):
                record = BlockchainTransaction.objects.create(
                    tx_hash=attempt.tx_hash,
                    tx_type="token_mint",
                    status="submitted",
                    from_address=intent["sender"],
                    to_address=intent["to"],
                    function_name="mint",
                    function_args={"recipient": intent["recipient"], "amount": intent["amount"]},
                    related_model="tokens.ShareIssuanceRequest",
                    related_uuid=request.pk,
                    submitted_at=attempt.created_at,
                )
                command.transaction_id = record.pk
                command.save(update_fields=["transaction", "updated_at"])
                issuance.transaction = record
                issuance.tx_hash = record.tx_hash
                issuance.status = "processing"
                issuance.processed_at = attempt.created_at
                issuance.save(update_fields=["transaction", "tx_hash", "status", "processed_at", "updated_at"])

            outgoing.sign_operation(claim, prepared, KEY, on_signed=retain)
    finally:
        restore_every_migration()
    tenant.issuance_request = request
    request.refresh_from_db()
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
        self.receipt_height = 12
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
                "blockNumber": self.receipt_height,
                "blockHash": self.block_hashes[self.receipt_height],
            }
        if self.lose_acknowledgement:
            raise ConnectionError("Synthetic acknowledgement loss")
        return tx_hash


def install_issuance(test):
    from django.contrib.auth.models import Permission
    from rest_framework.test import APIClient, APITransactionTestCase

    from tokens.tests.company_issue_fixtures import CompanyIssueCases

    class Fixture(CompanyIssueCases, APITransactionTestCase):
        pass

    fixture = Fixture()
    fixture.client = APIClient()
    for target in (
        "shared.uploads.scan_upload",
        "documents.services.extraction.scan_upload",
        "shared.upload_limits.reserve_request",
        "shared.upload_limits.reserve_bytes",
    ):
        fixture.enterContext(patch(target))
    test.addCleanup(fixture.doCleanups)
    fixture.setUp()
    proposal = fixture.prepare_issue(shares=10)
    fixture.issue_decide(proposal, "approve")
    with use_migrate():
        fixture.owner.is_staff = True
        fixture.owner.save(update_fields=["is_staff"])
        fixture.owner.user_permissions.add(
            Permission.objects.get(content_type__app_label="tokens", codename="change_shareissuancerequest")
        )
    with use_operator():
        test.company_issue = fixture
        test.proposal = proposal
        test.owner = test.actor = fixture.owner
        test.request = proposal.request
        test.token = fixture.token
        test.node = fixture.issuance_node
        test.node.receipt_height = test.node.head
        test.tenant = SimpleNamespace(
            user=fixture.owner,
            company=fixture.company,
            token=fixture.token,
            deployed_token=fixture.token,
            wallet=fixture.wallet,
            account=fixture.owner_account,
            issuance_request=test.request,
        )
        test.attempts = SignedAttempt.objects.filter(
            operation__operation_key=f"share-issuance:{test.request.pk}:{test.request.dispatch_id}"
        )
        test.operations = OutgoingOperation.objects.filter(
            operation_key=f"share-issuance:{test.request.pk}:{test.request.dispatch_id}"
        )
        test.transactions = BlockchainTransaction.objects.filter(
            related_model="tokens.ShareIssuanceRequest", related_uuid=test.request.pk
        )
        test.initial_nonce = SigningAccount.objects.get().next_nonce


def admit(request, actor, *, confirmed=None):
    from tokens.models import RegisterInstruction
    from tokens.services.register_issues import decide_issue, preview_issue_decision

    with patch("tokens.tasks.execute_review_request_task.defer"):
        prior = ShareIssuanceExecution.objects.filter(request_id=request.pk).first()
        if prior is not None:
            if confirmed is not None:
                return issuance_execution.admit(request, actor, confirmed=confirmed)
            return prior
        proposal = RegisterInstruction.objects.get(request_id=request.pk, kind="issue")
        _, preview = preview_issue_decision(
            actor=actor, issue_id=proposal.pk, appointment=proposal.preparing_appointment_id, kind="apply"
        )
        decide_issue(
            actor=actor,
            issue_id=proposal.pk,
            appointment=proposal.preparing_appointment_id,
            kind="apply",
            idempotency_key=request.dispatch_id,
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
        return ShareIssuanceExecution.objects.get(request_id=request.pk)


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
