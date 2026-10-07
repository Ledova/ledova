from unittest.mock import Mock, patch
from uuid import uuid4

from django.db import connections
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
from shared.db import current_alias, use_migrate, use_operator
from shared.tests.tenants import make_tenant
from tokens.models import TokenDeployment
from tokens.services.register_deployments import (
    decide_deployment,
    prepare_deployment,
    preview_deployment_decision,
)
from tokens.tests.evidence_fixtures import owner_appointment

FACTORY = "0x" + "f" * 40
CREATED = Web3.to_checksum_address("0x" + "c0ffee" + "0" * 34)


def deployment_token(name="deployment"):
    tenant = make_tenant(name)
    with use_migrate():
        Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.ACTIVE)
        tenant.company.refresh_from_db()
    with patch("tokens.services.register_deployments.queue_deployment"):
        admit_deployment(tenant.token, tenant.user)
    return tenant


def admit_deployment(token, actor, *, appointment=None):
    if appointment is None:
        appointment = owner_appointment(token.company)
    proposal = prepare_deployment(actor=actor, operation_id=uuid4(), appointment=appointment.pk, token=token.pk)
    for kind in ("approve", "apply"):
        _, preview = preview_deployment_decision(
            actor=actor, deployment_id=proposal.pk, appointment=appointment.pk, kind=kind
        )
        proposal = decide_deployment(
            actor=actor,
            deployment_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
    token.refresh_from_db()
    return proposal


def legacy_deployment_token(name="legacy-deployment", *, journal=True, signed=False):
    from blockchain.models import (
        BlockchainTransaction,
        TransactionStatus,
        TransactionType,
    )
    from blockchain.services import outgoing
    from shared.tests.schema import migrate_to, restore_every_migration
    from tokens.services import deployment

    tenant = make_tenant(name)
    with use_migrate():
        Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.ACTIVE)
        tenant.company.refresh_from_db()
    try:
        historical = migrate_to([("tokens", "0097_company_register_transfer_guards")])
        old_tokens = historical.get_model("tokens", "ShareToken").objects
        old_journals = historical.get_model("tokens", "TokenDeployment").objects
        identifier = uuid4()
        old_tokens.filter(pk=tenant.token.pk).update(status="deploying", deployment_id=identifier)
        tenant.token.refresh_from_db()
        intent = deployment._intent(tenant.token)
        if journal:
            command = old_journals.create(
                uuid=identifier,
                token_id=tenant.token.pk,
                company_id=tenant.company.pk,
                principal_id=tenant.user.pk,
                intent=intent,
            )
        if signed:
            admitted_signer()
            fields = {field: intent[field] for field in deployment.INTENT_FIELDS}
            fields["value"] = int(fields["value"])
            claim = outgoing.open_operation(f"token-deployment:{identifier}", **fields)
            command.operation_id = claim.operation_id
            command.save(update_fields=["operation", "updated_at"])
            prepared = outgoing.prepare_operation(claim, chain_client())

            def retain(attempt):
                record = BlockchainTransaction.objects.create(
                    tx_hash=attempt.tx_hash,
                    tx_type=TransactionType.SHARE_TOKEN_DEPLOY,
                    status=TransactionStatus.SUBMITTED,
                    from_address=intent["sender"],
                    to_address=intent["to"],
                    function_name="createShareToken",
                    function_args={
                        "name": intent["name"],
                        "symbol": intent["symbol"],
                        "identifier": intent["identifier"],
                        "authorizedShares": intent["authorized_shares"],
                        "tokenOwner": intent["sender"],
                        "issuerWallet": intent["issuer_wallet"],
                    },
                    related_model="tokens.ShareToken",
                    related_uuid=tenant.token.pk,
                    submitted_at=attempt.created_at,
                )
                command.transaction_id = record.pk
                command.save(update_fields=["transaction", "updated_at"])
                tenant.token.bind_deployment_transaction(attempt.tx_hash, record)

            outgoing.sign_operation(claim, prepared, KEY, on_signed=retain)
    finally:
        restore_every_migration()
    tenant.token.refresh_from_db()
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
    test.addCleanup(delete_approval_jobs, test.token.deployment_id)
    test.node = DeploymentNode()
    for target in (
        "tokens.services.deployment.get_base_chain_client",
        "tokens.services.share_token_service.get_base_chain_client",
    ):
        patcher = patch(target, return_value=test.node.client)
        patcher.start()
        test.addCleanup(patcher.stop)
    admitted_signer()


def delete_approval_jobs(deployment_id):
    with use_operator(), connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "DELETE FROM procrastinate_jobs WHERE task_name=%s AND args->>'deployment_id'=%s",
            ["tokens.tasks.deployment.recover_swap_approval", str(deployment_id)],
        )
