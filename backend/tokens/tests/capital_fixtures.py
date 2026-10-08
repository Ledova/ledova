from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from web3 import Web3

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.tests.outgoing_fixtures import (
    CHAIN_ID,
    KEY,
    SENDER,
    chain_client,
    receipt,
)
from shared.db import use_migrate, use_operator
from tokens.models import CapitalIncreaseExecution
from tokens.services import capital_execution


def capital_request(test):
    from django.conf import settings
    from django.contrib.auth.models import Permission
    from rest_framework.test import APIClient, APITransactionTestCase

    from tokens.tests.company_capital_fixtures import CompanyCapitalCases

    class Fixture(CompanyCapitalCases, APITransactionTestCase):
        pass

    fixture = Fixture()
    fixture.client = APIClient()
    if hasattr(test, "capital_private_media_root"):
        fixture.capital_private_media_root = test.capital_private_media_root
    elif hasattr(test, "company_issue") or hasattr(test, "company_capital"):
        fixture.capital_private_media_root = settings.PRIVATE_MEDIA_ROOT
    suffix = uuid4().hex
    fixture.capital_label = "capital-company-" + suffix
    acn = f"{int(suffix[:8], 16) % 100000000:08d}"
    check = (10 - sum(int(digit) * weight for digit, weight in zip(acn, range(8, 0, -1))) % 10) % 10
    fixture.capital_acn = acn + str(check)
    fixture.capital_contract = Web3.to_checksum_address("0x" + suffix + "0" * 8)
    for target in (
        "shared.uploads.scan_upload",
        "documents.services.extraction.scan_upload",
        "shared.upload_limits.reserve_request",
        "shared.upload_limits.reserve_bytes",
    ):
        fixture.enterContext(patch(target))
    test.addCleanup(fixture.doCleanups)
    fixture.setUp()
    proposal = fixture.prepare_capital()
    fixture.capital_decide(proposal, "approve")
    with use_migrate():
        fixture.owner.is_staff = True
        fixture.owner.save(update_fields=["is_staff"])
        fixture.owner.user_permissions.add(
            Permission.objects.get(content_type__app_label="tokens", codename="change_capitalincreaserequest")
        )
    with use_operator():
        request = proposal.request
        tenant = SimpleNamespace(
            user=fixture.owner,
            company=fixture.company,
            token=fixture.token,
            deployed_token=fixture.token,
            account=fixture.owner_account,
            wallet=fixture.issuer_wallet,
            capital_increase=request,
            company_capital=fixture,
        )
    return tenant, fixture.owner


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
    test.tenant, test.actor = capital_request(test)
    with use_operator():
        test.company_capital = test.tenant.company_capital
        test.request = test.tenant.capital_increase
        test.token = test.request.token
        test.proposal = test.request.company_instruction
        test.owner = test.actor
        test.node = test.company_capital.capital_node
        test.attempts = SignedAttempt.objects.filter(
            operation__operation_key=f"capital-increase:{test.request.pk}:{test.request.dispatch_id}"
        )
        test.operations = OutgoingOperation.objects.filter(
            operation_key=f"capital-increase:{test.request.pk}:{test.request.dispatch_id}"
        )
        test.transactions = BlockchainTransaction.objects.filter(
            related_model="tokens.CapitalIncreaseRequest", related_uuid=test.request.pk
        )
        test.initial_nonce = SigningAccount.objects.get().next_nonce


def admit(request, actor, *, confirmed=None):
    from tokens.models import RegisterCapitalIncrease
    from tokens.services.register_capital_increases import (
        decide_capital_increase,
        preview_capital_increase_decision,
    )

    prior = CapitalIncreaseExecution.objects.filter(request_id=request.pk).first()
    if prior is not None:
        with patch("tokens.services.capital_execution._enqueue"):
            return capital_execution.admit(
                request, actor, confirmed=confirmed or capital_execution.confirmation(request, actor)
            )
    proposal = RegisterCapitalIncrease.objects.get(request_id=request.pk)
    _, preview = preview_capital_increase_decision(
        actor=actor, capital_increase_id=proposal.pk, appointment=proposal.preparing_appointment_id, kind="apply"
    )
    with patch("tokens.services.capital_execution._enqueue"):
        decide_capital_increase(
            actor=actor,
            capital_increase_id=proposal.pk,
            appointment=proposal.preparing_appointment_id,
            kind="apply",
            idempotency_key=request.dispatch_id,
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
    return CapitalIncreaseExecution.objects.get(request_id=request.pk)


__all__ = ["CHAIN_ID", "KEY", "SENDER", "CapitalNode", "admit", "capital_request", "install_capital"]
