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
from tokens.services import deployment, pause_recovery
from tokens.services.register_pause_changes import (
    decide_pause_change,
    prepare_pause_change,
    preview_pause_change_decision,
)
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
from tokens.tests.pause_fixtures import PauseNode
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_requests import CompanyEligibilityCases
from wallets.models import Wallet
from wallets.services.verification import (
    complete_wallet_verification,
    start_wallet_verification,
)


class CompanyPauseCases(StubUploadDependencies):
    company_fixture = CompanyEligibilityCases.company_fixture
    appointee = CompanyEligibilityCases.appointee
    appoint_actor = CompanyEligibilityCases.appoint_actor

    def setUp(self):
        super().setUp()
        if not hasattr(self, "pause_private_media_root"):
            directory = tempfile.TemporaryDirectory()
            self.addCleanup(directory.cleanup)
            self.pause_private_media_root = directory.name
        self.enterContext(
            override_settings(
                PRIVATE_MEDIA_ROOT=self.pause_private_media_root,
                STORAGES=STORAGES,
                BLOCKCHAIN_OPERATOR_KEY=KEY,
                BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
                SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
                WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "finalized"}},
            )
        )
        with use_operator():
            self.owner, self.owner_account = make_investor(getattr(self, "pause_label", "pause-company-owner"))
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.company, self.initial = self.company_fixture("Pause Pty Ltd", getattr(self, "pause_acn", "123456780"))
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
                company=self.company, name="Company pause", symbol="PAU", total_supply="1000", decimals=0
            )
            if not SigningAccount.objects.filter(chain_id=CHAIN_ID, address=SENDER.lower()).exists():
                admitted_signer()
        node = DeploymentNode()
        if hasattr(self, "pause_contract"):
            node.event_changes["tokenAddress"] = self.pause_contract
        with use_operator(), patch("tokens.services.register_deployments.queue_deployment"):
            admit_deployment(self.token, self.owner, appointment=self.initial)
        with use_operator(), patch(
            "tokens.tests.deployment_fixtures.CREATED", getattr(self, "pause_contract", CREATED)
        ), patch("tokens.services.deployment.get_base_chain_client", return_value=node.client), patch(
            "tokens.services.share_token_service.get_base_chain_client", return_value=node.client
        ):
            self.assertTrue(deployment.deploy_token(self.token))
            self.token.refresh_from_db()
        self.node = PauseNode(self.token.contract_address)
        self.enterContext(patch("tokens.services.pause_recovery.get_base_chain_client", return_value=self.node.client))
        self.client.force_authenticate(self.owner)

    def pause_payload(self, **changes):
        actor = changes.get("actor", self.owner)
        appointment = changes.get("appointment", self.initial)
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        values = dict(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            token=self.token.pk,
            paused=True,
            reason="Stop share transfers for the company",
            authority_reference="BOARD-PAUSE-100",
            authority_evidence=evidence.pk,
        )
        values.update(changes)
        if hasattr(values["appointment"], "pk"):
            values["appointment"] = values["appointment"].pk
        return values

    def prepare_pause(self, **changes):
        return prepare_pause_change(**self.pause_payload(**changes))

    def pause_decide(self, proposal, kind, **changes):
        actor = changes.pop("actor", self.owner)
        appointment = changes.pop("appointment", self.initial)
        _, result = preview_pause_change_decision(
            actor=actor,
            pause_change_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            reason=changes.get("reason", ""),
        )
        values = dict(
            actor=actor,
            pause_change_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=result["preview_digest"],
            confirmation=True,
        )
        values.update(changes)
        return decide_pause_change(**values), values

    def applied_pause(self, **changes):
        proposal = self.prepare_pause(**changes)
        self.pause_decide(proposal, "approve")
        return self.pause_decide(proposal, "apply")[0]

    def execute_pause(self, proposal):
        with use_operator():
            return pause_recovery.recover(proposal.pk)
