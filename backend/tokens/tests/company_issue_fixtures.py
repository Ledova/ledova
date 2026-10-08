from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import override_settings
from django.utils import timezone
from eth_account import Account
from eth_account.messages import encode_defunct

from companies.models import Company
from companies.services.authority_requests import _requester_principal
from shared.db import use_operator
from tokens.models import RegisterEvidenceKind, ShareToken
from tokens.services import deployment, issuance_execution, register_snapshot
from tokens.services.register_issues import (
    decide_issue,
    prepare_issue,
    preview_issue_decision,
)
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening,
    preview_opening_decision,
)
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    FACTORY,
    KEY,
    DeploymentNode,
    admit_deployment,
)
from tokens.tests.evidence_fixtures import upload_evidence
from tokens.tests.issuance_fixtures import IssuanceNode
from tokens.tests.test_register_links import linked
from tokens.tests.test_register_snapshot import SnapshotNode, block_hash
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from wallets.services.verification import (
    complete_wallet_verification,
    start_wallet_verification,
)
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases


class CompanyIssueCases(CompanyWalletCases):
    def setUp(self):
        self.enterContext(
            override_settings(
                BLOCKCHAIN_OPERATOR_KEY=KEY,
                BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
                SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
                WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "finalized"}},
            )
        )
        super().setUp()
        with use_operator():
            account = UserAccount.objects.get(user_profile__user=self.owner)
            self.issuer_wallet = Wallet.objects.create(
                user_account=account, address=Account.from_key(KEY).address, chain="base"
            )
        with _requester_principal(self.owner.pk):
            challenge = start_wallet_verification(self.owner, self.issuer_wallet.pk).verification_challenge
        signature = Account.sign_message(encode_defunct(text=challenge), private_key=KEY).signature.to_0x_hex()
        complete_wallet_verification(self.owner, self.issuer_wallet.pk, signature)
        with use_operator():
            self.token = ShareToken.objects.create(
                company=self.company, name="Current company grant", symbol="GRANT", total_supply="100"
            )
            self.deployment = admit_deployment(self.token, self.owner, appointment=self.initial)
            deployment_node = DeploymentNode()
            with (
                patch("tokens.services.deployment.get_base_chain_client", return_value=deployment_node.client),
                patch("tokens.services.share_token_service.get_base_chain_client", return_value=deployment_node.client),
            ):
                deployment.deploy_token(self.token)
            self.token.refresh_from_db()
            target = register_snapshot._target(self.token.pk)
        self.snapshot_node = SnapshotNode()
        self.snapshot_node.target = target
        height = target.deployment_block
        self.snapshot_node.finalized = height + 2
        self.snapshot_node.blocks = {
            h: {
                "number": h,
                "hash": target.deployment_hash if h == height else block_hash(h),
                "timestamp": 1789862400 + h,
            }
            for h in (height, height + 1, height + 2)
        }
        self.snapshot_node.events = []
        self.snapshot_node.balances = {}
        self.snapshot_node.contract.functions.totalSupply.return_value.call.return_value = 0
        self.snapshot_node.contract.functions.authorizedShares.return_value.call.return_value = 100
        for module in ("register_openings", "register_snapshot"):
            self.enterContext(
                patch(f"tokens.services.{module}.get_base_chain_client", return_value=self.snapshot_node.client)
            )
        evidence = upload_evidence(self.owner, self.initial, RegisterEvidenceKind.AUTHORITY)
        self.opening, _ = prepare_opening(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            token_id=self.token.pk,
            authority_evidence=evidence.pk,
            mapping=[],
            authority="director_resolution",
            approving_director="Synthetic Director",
            authority_reference="EMPTY-CHAIN-OPENING",
            reason="Open the genuine empty class",
            client=self.snapshot_node.client,
        )
        for kind in ("approve", "apply"):
            _, preview = preview_opening_decision(
                actor=self.owner, opening_id=self.opening.pk, appointment=self.initial.pk, kind=kind
            )
            self.opening = decide_opening(
                actor=self.owner,
                opening_id=self.opening.pk,
                appointment=self.initial.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
        self.administrator = self.initial
        self.nomination = self.nominate()
        wallet_instruction = self.prepare_wallet(self.nomination)
        self.wallet_decide(wallet_instruction, "approve")
        self.wallet_instruction, _ = self.wallet_decide(wallet_instruction, "apply")
        self.wallet_change = self.execute(self.wallet_instruction)
        self.assertIn(self.wallet_change.status, ("confirmed", "unchanged"))
        self.member = uuid4()
        with use_operator():
            self.initial.company = Company.objects.get(pk=self.initial.company_id)
            self.assertEqual(self.initial.company_id, self.company.pk)
        self.link = linked(self.owner, self.initial, [{"address": self.wallet.address, "member": str(self.member)}])
        with use_operator():
            participant_profile = UserProfile.objects.get(user=self.participant)
            if not participant_profile.residential_address:
                participant_profile.residential_address = "1 Synthetic Street"
                participant_profile.save(update_fields=["residential_address"])
        self.issuance_node = IssuanceNode()
        self.issuance_node.head = self.issuance_node.finalized = height + 3
        self.issuance_node.block_hashes[height + 3] = block_hash(height + 3)
        original_send = self.issuance_node.send

        def send(raw):
            tx_hash = original_send(raw)
            if tx_hash in self.issuance_node.receipts:
                self.issuance_node.receipts[tx_hash].update(blockNumber=height + 3, blockHash=block_hash(height + 3))
            return tx_hash

        self.issuance_node.client.send_raw_transaction.side_effect = send
        self.issuance_node.contract.functions.authorizedShares.return_value.call.return_value = 100
        self.issuance_node.contract.functions.whitelist.return_value.call.return_value = (
            self.wallet_change.registry_address
        )
        self.enterContext(
            patch("tokens.services.issuance_execution.get_base_chain_client", return_value=self.issuance_node.client)
        )
        self.enterContext(patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=True))
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))

    def issue_payload(self, **changes):
        actor = changes.get("actor", self.owner)
        appointment = changes.get("appointment", self.initial)
        authority = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        terms = upload_evidence(actor, appointment, RegisterEvidenceKind.SUPPORTING)
        values = dict(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            token=self.token.pk,
            member=self.member,
            nomination=self.nomination.pk,
            wallet_approval=self.wallet_change.pk,
            shares=25,
            approving_director="Synthetic Director",
            authority_reference="NON-PAID-GRANT",
            reason="Outright employee grant",
            terms_on=(timezone.now() - timedelta(days=5)).date(),
            terms="Outright non-paid employee grant under the company resolution",
            acceptance_required=False,
            authority_evidence=authority.pk,
            terms_evidence=terms.pk,
        )
        values.update(changes)
        values["appointment"] = getattr(values["appointment"], "pk", values["appointment"])
        return values

    def prepare_issue(self, **changes):
        return prepare_issue(**self.issue_payload(**changes))

    def issue_preview(self, proposal, kind="apply", **changes):
        values = dict(actor=self.owner, issue_id=proposal.pk, appointment=self.initial.pk, kind=kind)
        values.update(changes)
        return preview_issue_decision(**values)[1]

    def issue_decide(self, proposal, kind, **changes):
        actor = changes.pop("actor", self.owner)
        appointment = changes.pop("appointment", self.initial.pk)
        reason = changes.pop("reason", "")
        preview = self.issue_preview(proposal, kind, actor=actor, appointment=appointment, reason=reason)
        values = dict(
            actor=actor,
            issue_id=proposal.pk,
            appointment=appointment,
            kind=kind,
            reason=reason,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
        values.update(changes)
        return decide_issue(**values), values

    def applied_issue(self, **changes):
        proposal = self.prepare_issue(**changes)
        self.issue_decide(proposal, "approve")
        return self.issue_decide(proposal, "apply")[0]

    def execute_issue(self, proposal):
        with use_operator():
            return issuance_execution.recover(proposal.request.dispatch_id)
