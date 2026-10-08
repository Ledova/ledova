import tempfile
from unittest.mock import patch
from uuid import uuid4

from django.test import override_settings
from eth_account import Account
from eth_account.messages import encode_defunct

from blockchain.models import SigningAccount
from companies.services.authority_requests import _requester_principal
from companies.tests.test_authority_requests import STORAGES
from operators.models import Operator
from shared.db import use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.models import RegisterEvidenceKind, ShareToken
from tokens.services import capital_execution, deployment
from tokens.services.register_capital_increases import (
    decide_capital_increase,
    prepare_capital_increase,
    preview_capital_increase_decision,
)
from tokens.tests.capital_fixtures import CapitalNode
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    SENDER,
    DeploymentNode,
    admit_deployment,
    admitted_signer,
)
from tokens.tests.evidence_fixtures import upload_evidence
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_requests import CompanyEligibilityCases
from wallets.models import Wallet
from wallets.services.verification import (
    complete_wallet_verification,
    start_wallet_verification,
)


class CompanyCapitalCases(StubUploadDependencies):
    company_fixture = CompanyEligibilityCases.company_fixture
    appointee = CompanyEligibilityCases.appointee
    appoint_actor = CompanyEligibilityCases.appoint_actor

    def setUp(self):
        super().setUp()
        if not hasattr(self, "capital_private_media_root"):
            directory = tempfile.TemporaryDirectory()
            self.addCleanup(directory.cleanup)
            self.capital_private_media_root = directory.name
        self.enterContext(
            override_settings(
                PRIVATE_MEDIA_ROOT=self.capital_private_media_root,
                STORAGES=STORAGES,
                BLOCKCHAIN_OPERATOR_KEY=KEY,
                BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
                SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
                WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "finalized"}},
            )
        )
        with use_operator():
            self.owner, self.owner_account = make_investor(getattr(self, "capital_label", "capital-company-owner"))
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.company, self.initial = self.company_fixture("Capital Pty Ltd", getattr(self, "capital_acn", "123456780"))
        with use_operator():
            self.issuer_wallet = Wallet.objects.create(
                user_account=self.owner_account, address=Account.from_key(KEY).address, chain="base"
            )
        with _requester_principal(self.owner.pk):
            challenge = start_wallet_verification(self.owner, self.issuer_wallet.pk).verification_challenge
        signature = Account.sign_message(encode_defunct(text=challenge), private_key=KEY).signature.to_0x_hex()
        complete_wallet_verification(self.owner, self.issuer_wallet.pk, signature)
        with use_operator():
            self.token = ShareToken.objects.create(
                company=self.company, name="Company capital", symbol="CAP", total_supply="1000"
            )
            if not SigningAccount.objects.filter(chain_id=CHAIN_ID, address=SENDER.lower()).exists():
                admitted_signer()
        node = DeploymentNode()
        if hasattr(self, "capital_contract"):
            node.event_changes["tokenAddress"] = self.capital_contract
        with use_operator(), patch("tokens.services.register_deployments.queue_deployment"):
            admit_deployment(self.token, self.owner, appointment=self.initial)
        with use_operator(), patch(
            "tokens.tests.deployment_fixtures.CREATED", getattr(self, "capital_contract", CREATED)
        ), patch("tokens.services.deployment.get_base_chain_client", return_value=node.client), patch(
            "tokens.services.share_token_service.get_base_chain_client", return_value=node.client
        ):
            self.assertTrue(deployment.deploy_token(self.token))
            self.token.refresh_from_db()
        self.capital_node = CapitalNode()
        for module in ("capital_execution", "register_capital_increases"):
            self.enterContext(
                patch(f"tokens.services.{module}.get_base_chain_client", return_value=self.capital_node.client)
            )
        self.enqueue = capital_execution._enqueue
        self.queue = self.enterContext(patch("tokens.services.capital_execution._enqueue"))
        self.client.force_authenticate(self.owner)

    def capital_payload(self, **changes):
        actor = changes.get("actor", self.owner)
        appointment = changes.get("appointment", self.initial)
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        values = dict(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            token=self.token.pk,
            additional_shares=100,
            new_authorized_total=1100,
            purpose="Increase the authorised cap without minting",
            board_resolution_reference="BOARD-CAP-100",
            shareholder_approval_reference="",
            authority_evidence=evidence.pk,
        )
        values.update(changes)
        if hasattr(values["appointment"], "pk"):
            values["appointment"] = values["appointment"].pk
        return values

    def prepare_capital(self, **changes):
        return prepare_capital_increase(**self.capital_payload(**changes))

    def capital_decide(self, proposal, kind, **changes):
        actor = changes.pop("actor", self.owner)
        appointment = changes.pop("appointment", self.initial)
        _, result = preview_capital_increase_decision(
            actor=actor,
            capital_increase_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            reason=changes.get("reason", ""),
        )
        values = dict(
            actor=actor,
            capital_increase_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=result["preview_digest"],
            confirmation=True,
        )
        values.update(changes)
        return decide_capital_increase(**values), values

    def applied_capital(self):
        proposal = self.prepare_capital()
        self.capital_decide(proposal, "approve")
        return self.capital_decide(proposal, "apply")[0]

    def execute_capital(self, proposal):
        with use_operator():
            return capital_execution.recover(proposal.request.dispatch_id)
