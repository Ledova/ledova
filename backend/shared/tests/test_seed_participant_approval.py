from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.services.team import revoke_company_appointment
from shared.db import use_operator
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.chain.approvals import approve_participant_wallet
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.market.keyring import KeyRing
from shared.seeds.synthetic.market.layer import _approve
from shared.tests.upload_fixtures import StubUploadDependencies
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from wallets.models import Wallet, WalletPossessionProof
from wallets.services.wallets import verify_wallet_signature
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletNomination,
    WhitelistChange,
)
from whitelist.services import changes
from whitelist.tests.change_fixtures import (
    CHAIN_ID,
    FACTORY,
    KEY,
    WhitelistNode,
    admitted_signer,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class SyntheticParticipantApprovalTest(
    CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def setUp(self):
        super().setUp()
        self.request, self.eligibility_decision = self.accepted()
        with use_operator():
            self.wallet = Wallet.objects.create(
                user_account=self.account,
                address=keys.evm_address(keys.hardhat_keys([1])[0].key),
                chain="base",
                verification_status="VERIFIED",
                verified_at=timezone.now() - timedelta(days=1),
            )
            admitted_signer()
        self.node = WhitelistNode()
        self.node.contract.functions.expiresAt.side_effect = lambda address: Mock(
            call=Mock(return_value=self.node.expiries.get(address.lower(), 0))
        )
        for name in (
            "whitelist.services.changes.get_base_chain_client",
            "whitelist.services.whitelist.get_base_chain_client",
            "whitelist.services.company_wallet_instructions.get_base_chain_client",
            "whitelist.services.eligibility_invalidation.get_base_chain_client",
        ):
            self.enterContext(patch(name, return_value=self.node.client))

    def assert_genuine_approval(self, change, status):
        with use_operator():
            self.wallet.refresh_from_db()
            proof = WalletPossessionProof.objects.get(wallet_id=self.wallet.pk)
            nomination = CompanyWalletNomination.objects.get(wallet_id=self.wallet.pk)
            instruction = CompanyWalletInstruction.objects.get(change_id=change.pk)
            approval = instruction.decisions.get(kind="approve")
            application = instruction.decisions.get(kind="apply")
            self.assertEqual(change.status, status)
            self.assertEqual(nomination.request_id, self.request.pk)
            self.assertEqual(nomination.decision_id, self.eligibility_decision.pk)
            self.assertEqual(nomination.proof_id, proof.pk)
            self.assertEqual(nomination.submitted_by_id, self.participant.pk)
            self.assertEqual(proof.verified_by_id, self.participant.pk)
            self.assertEqual(proof.completed_at, self.wallet.verified_at)
            self.assertTrue(verify_wallet_signature(self.wallet.address, proof.challenge, proof.signature, "BASE"))
            self.assertIsNone(self.wallet.verification_challenge)
            self.assertEqual(instruction.preparing_appointment_id, self.initial.pk)
            self.assertEqual(instruction.submitted_by_id, self.owner.pk)
            self.assertEqual(instruction.approval_decision_id, approval.pk)
            self.assertEqual((approval.appointment_id, application.appointment_id), (self.initial.pk, self.initial.pk))
            self.assertEqual((approval.decided_by_id, application.decided_by_id), (self.owner.pk, self.owner.pk))
            self.assertEqual(change.source_instruction_id, instruction.pk)
            self.assertEqual(change.initiated_by_id, self.owner.pk)
            self.assertEqual(change.expires_at, self.eligibility_decision.expires_at.replace(microsecond=0))
            self.assertEqual(change.expires_at.microsecond, 0)
            self.assertEqual(changes.recover(change.pk).pk, change.pk)
            self.assertEqual(WhitelistChange.objects.count(), 1)
            self.assertFalse(self.owner.is_staff)

    def test_known_participant_key_refreshes_real_proof_and_consumes_the_exact_current_company_sources(self):
        with use_operator():
            self.assertFalse(WalletPossessionProof.objects.exists())
        change = approve_participant_wallet(self.company, self.wallet, KeyRing())
        self.assert_genuine_approval(change, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_market_approval_uses_the_same_participant_flow_and_preserves_observed_unchanged_without_a_signature(self):
        self.node.expiries[self.wallet.address.lower()] = int(self.eligibility_decision.expires_at.timestamp())
        market = SimpleNamespace(
            companies={"synthetic-company": self.company},
            wallet=lambda investor, address: self.wallet,
            keyring=KeyRing(),
        )
        change = _approve(
            SimpleNamespace(company="synthetic-company", investor=self.participant.email, address=self.wallet.address),
            market,
        )
        self.assert_genuine_approval(change, "unchanged")
        self.assertEqual(self.node.broadcasts, [])

    def test_lost_company_administration_is_refused_without_creating_proof_nomination_or_instruction(self):
        revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
        with self.assertRaisesMessage(ChainStepFailed, "existing current personal ADMIN"):
            approve_participant_wallet(self.company, self.wallet, KeyRing())
        with use_operator():
            self.assertFalse(WalletPossessionProof.objects.exists())
            self.assertFalse(CompanyWalletNomination.objects.exists())
            self.assertFalse(CompanyWalletInstruction.objects.exists())
            self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_lost_general_eligibility_is_refused_without_manufacturing_a_replacement_source(self):
        self.client.force_authenticate(self.participant)
        response = self.client.post(
            f"/api/v1/company-eligibility/requests/{self.request.pk}/withdraw/",
            {"idempotency_key": str(uuid4())},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        with self.assertRaisesMessage(ChainStepFailed, "current finite GENERAL"):
            approve_participant_wallet(self.company, self.wallet, KeyRing())
        with use_operator():
            self.assertFalse(WalletPossessionProof.objects.exists())
            self.assertFalse(CompanyWalletNomination.objects.exists())
            self.assertFalse(CompanyWalletInstruction.objects.exists())
            self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])
