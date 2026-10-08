import logging
from unittest.mock import patch

from django.conf import settings
from eth_account import Account
from web3 import Web3

from blockchain.models import SignedAttempt, SigningAccount
from blockchain.tests.outgoing_fixtures import admitted_signer
from shared.db import use_operator
from tokens.models import ShareToken, TokenDeployment
from tokens.tasks import deploy_share_token_task
from tokens.tests.deployment_fixtures import admit_deployment, delete_approval_jobs
from wallets.models import Wallet, WalletPossessionProof
from whitelist.models import (
    CompanyWalletInstructionDecision,
    CompanyWalletNomination,
    WhitelistApproval,
    WhitelistChange,
)
from whitelist.services import changes, whitelist
from whitelist.services.company_wallet_instructions import execution_receipt
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases

logger = logging.getLogger(__name__)


class CompanyWalletChainCases(CompanyWalletCases):
    def setUp(self):
        super().setUp()
        for name in (
            "whitelist.services.changes.get_base_chain_client",
            "whitelist.services.whitelist.get_base_chain_client",
            "whitelist.services.company_wallet_instructions.get_base_chain_client",
            "whitelist.services.eligibility_invalidation.get_base_chain_client",
        ):
            self.enterContext(patch(name, return_value=self.chain))
        self.signer = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        with use_operator():
            self.signing_account = admitted_signer(sender=self.signer, chain_id=settings.BLOCKCHAIN_CHAIN_ID)
            self.issuer_wallet = Wallet.objects.create(
                user_account=self.owner_account,
                address=self.signer,
                chain="base",
                verification_status="VERIFIED",
            )
            self.token = ShareToken.objects.create(
                company=self.company, name="Company wallet chain shares", symbol="WCHAIN", total_supply="1000"
            )
        self.deployment_proposal = admit_deployment(self.token, self.owner, appointment=self.initial)
        self.addCleanup(delete_approval_jobs, self.token.deployment_id)
        result = deploy_share_token_task(
            token_uuid=str(self.token.pk),
            deployment_id=str(self.token.deployment_id),
            principal_id=self.owner.pk,
        )
        self.assertTrue(result["success"], result)
        with use_operator():
            self.token.refresh_from_db()
            self.deployment = TokenDeployment.objects.select_related("operation__current_attempt").get(
                pk=self.token.deployment_id
            )
        self.contract = self.chain.load_contract("ShareToken", self.token.contract_address)
        self.registry_address = whitelist.registry_for(self.company, self.chain)
        self.registry = whitelist.registry_contract(self.registry_address, self.chain)

    def assert_company_wallet_receipt(self, proposal, nonce, expiry):
        with use_operator():
            proposal.refresh_from_db()
            change = WhitelistChange.objects.select_related("operation__current_attempt", "transaction").get(
                pk=proposal.change_id
            )
            approval = CompanyWalletInstructionDecision.objects.get(pk=proposal.approval_decision_id)
            application = CompanyWalletInstructionDecision.objects.get(instruction=proposal, kind="apply")
            receipt = execution_receipt(proposal)
            attempt = change.operation.current_attempt
            self.assertEqual(change.operation.attempts.count(), 1)
        self.assertEqual(proposal.status, "applied")
        self.assertEqual(proposal.preparing_appointment_id, self.initial.pk)
        self.assertEqual(proposal.submitted_by_id, self.owner.pk)
        self.assertEqual(proposal.reviewed_by_id, self.owner.pk)
        self.assertEqual(approval.kind, "approve")
        for decision in (approval, application):
            self.assertEqual(decision.decided_by_id, self.owner.pk)
            self.assertEqual(decision.appointment_id, self.initial.pk)
        self.assertEqual(change.status, "confirmed")
        self.assertEqual(change.source_instruction_id, proposal.pk)
        self.assertEqual(change.authority, "company")
        self.assertEqual(change.initiated_by_id, application.decided_by_id)
        self.assertEqual(change.company_id, self.company.pk)
        self.assertEqual(change.address, self.wallet.address.lower())
        self.assertEqual(change.requested_wallet_id, self.wallet.pk if proposal.action == "add" else None)
        self.assertEqual(change.registry_address, self.registry_address)
        self.assertEqual(change.chain_id, 31337)
        self.assertEqual(change.action, proposal.action)
        self.assertEqual(change.expires_at, proposal.expires_at)
        self.assertEqual(change.intent, proposal.intent)
        self.assertEqual(change.operation.intent, proposal.intent)
        self.assertEqual(change.operation.status, "confirmed")
        self.assertIsNotNone(change.completed_at)
        self.assertEqual(attempt.nonce, nonce)
        self.assertEqual(attempt.claim_id, change.operation.claim_id)
        self.assertEqual(attempt.signer_id, self.signing_account.pk)
        self.assertEqual(Account.recover_transaction(bytes(attempt.raw_transaction)), self.signer)
        self.assertEqual(Web3.to_hex(Web3.keccak(bytes(attempt.raw_transaction))), attempt.tx_hash)
        transaction = self.chain.w3.eth.get_transaction(attempt.tx_hash)
        mined = self.chain.w3.eth.get_transaction_receipt(attempt.tx_hash)
        self.assertEqual(transaction["from"], self.signer)
        self.assertEqual(transaction["to"].lower(), self.registry_address)
        self.assertEqual(transaction["nonce"], nonce)
        self.assertEqual(Web3.to_hex(transaction["input"]), proposal.intent["data"])
        self.assertEqual(mined["status"], 1)
        self.assertEqual(change.operation.block_number, mined["blockNumber"])
        self.assertEqual(change.operation.block_hash, Web3.to_hex(mined["blockHash"]))
        self.assertEqual(change.operation.gas_used, mined["gasUsed"])
        self.assertEqual(change.transaction.tx_hash, attempt.tx_hash)
        self.assertEqual(change.transaction.status, "confirmed")
        self.assertEqual(change.transaction.function_args, {"investor": change.address, "expiry": str(expiry)})
        self.assertEqual(receipt["operation_id"], change.operation_id)
        self.assertEqual(receipt["claim_id"], attempt.claim_id)
        self.assertEqual(receipt["tx_hash"], attempt.tx_hash)
        self.assertEqual(receipt["transaction"], change.transaction_id)
        self.assertEqual(receipt["block_number"], mined["blockNumber"])
        self.assertEqual(receipt["block_hash"], Web3.to_hex(mined["blockHash"]))
        logger.info(
            "Company wallet %s confirmed: tx_hash=%s nonce=%s expiry=%s source=%s",
            proposal.action,
            attempt.tx_hash,
            nonce,
            expiry,
            proposal.pk,
        )
        return change, bytes(attempt.raw_transaction)

    def test_current_company_add_and_remove_use_real_signed_journals_and_exact_finite_expiry(self):
        self.assertFalse(self.owner.is_staff)
        self.assertFalse(self.owner.is_superuser)
        self.assertEqual(set(self.initial.capabilities), {"admin"})
        self.assertEqual(self.initial.appointee_id, self.owner.pk)
        self.assertEqual(self.initial.company_id, self.company.pk)
        self.assertIsNotNone(self.initial.request_id)
        self.assertIsNone(self.request.offering_id)
        self.assertIsNone(self.request.token_id)
        self.assertIsNone(self.request.quantity)
        self.assertEqual(self.request.company_id, self.company.pk)
        self.assertEqual(self.eligibility_decision.request_id, self.request.pk)
        self.assertEqual(self.eligibility_decision.outcome, "accepted")
        self.assertIsNotNone(self.eligibility_decision.expires_at)
        self.assertEqual(self.deployment.source_deployment_id, self.deployment_proposal.pk)
        self.assertEqual(self.deployment.principal_id, self.owner.pk)
        self.assertEqual(self.deployment_proposal.preparing_appointment_id, self.initial.pk)
        self.assertEqual(self.deployment.intent["issuer_wallet"], self.issuer_wallet.address.lower())
        self.assertEqual(self.deployment.operation.status, "confirmed")
        self.assertEqual(self.contract.functions.totalSupply().call(), 0)
        self.assertEqual(self.contract.functions.authorizedShares().call(), 1000)
        selected = Web3.to_checksum_address(self.wallet.address)
        self.assertEqual(self.registry.functions.expiresAt(selected).call(), 0)
        nonce = self.chain.w3.eth.get_transaction_count(self.signer, "pending")
        nomination = self.nominate()
        with use_operator():
            proof = WalletPossessionProof.objects.get(pk=nomination.proof_id)
            self.assertEqual(WalletPossessionProof.objects.count(), 1)
            self.assertEqual(CompanyWalletNomination.objects.count(), 1)
            self.assertEqual(nomination.company_id, self.company.pk)
            self.assertEqual(nomination.request_id, self.request.pk)
            self.assertEqual(nomination.decision_id, self.eligibility_decision.pk)
            self.assertEqual(nomination.wallet_id, self.wallet.pk)
            self.assertEqual(nomination.submitted_by_id, self.participant.pk)
            self.assertEqual(proof.wallet_id, self.wallet.pk)
            self.assertEqual(proof.verified_by_id, self.participant.pk)
            self.assertEqual(nomination.snapshot["address"], self.wallet.address.lower())
            self.assertEqual(nomination.snapshot["proof_digest"], proof.digest)
        add = self.prepare_wallet(nomination)
        self.assertGreater(add.expires_at.timestamp(), self.chain.w3.eth.get_block("latest")["timestamp"])
        self.assertLessEqual(add.expires_at, self.eligibility_decision.expires_at)
        expiry = int(add.expires_at.timestamp())
        self.wallet_decide(add, "approve")
        add, _ = self.wallet_decide(add, "apply")
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get(pk=add.change_id).status, "pending")
            self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self.registry.functions.expiresAt(selected).call(), 0)
        self.assertEqual(self.execute(add).status, "confirmed")
        original_add, original_add_bytes = self.assert_company_wallet_receipt(add, nonce, expiry)
        self.assertEqual(self.registry.functions.expiresAt(selected).call(), expiry)
        self.assertTrue(self.registry.functions.isWhitelisted(selected).call())
        with use_operator():
            projection = WhitelistApproval.objects.get(company=self.company, entry_id=original_add.entry_id)
            self.assertEqual(projection.status, "active")
            self.assertEqual(projection.expires_at, add.expires_at)
            self.assertIsNotNone(projection.last_synced_at)
        remove = self.prepare_wallet(action="remove", nomination=None, target_change=original_add.pk, expires_at=None)
        self.assertEqual(remove.target_change_id, original_add.pk)
        self.assertIsNone(remove.nomination_id)
        self.assertIsNone(remove.expires_at)
        self.wallet_decide(remove, "approve")
        remove, _ = self.wallet_decide(remove, "apply")
        self.assertEqual(self.registry.functions.expiresAt(selected).call(), expiry)
        self.assertEqual(self.execute(remove).status, "confirmed")
        original_remove, original_remove_bytes = self.assert_company_wallet_receipt(remove, nonce + 1, 0)
        self.assertEqual(self.registry.functions.expiresAt(selected).call(), 0)
        self.assertFalse(self.registry.functions.isWhitelisted(selected).call())
        with use_operator():
            projection.refresh_from_db()
            self.assertEqual(projection.status, "removed")
            self.assertIsNone(projection.expires_at)
            self.assertEqual(projection.registry_address, self.registry_address)
            self.assertEqual(WhitelistChange.objects.count(), 2)
            self.assertEqual(CompanyWalletInstructionDecision.objects.count(), 4)
            self.assertEqual(CompanyWalletNomination.objects.count(), 1)
            self.assertEqual(SignedAttempt.objects.count(), 3)
            original_add.refresh_from_db()
            self.assertEqual(original_add.source_instruction_id, add.pk)
            self.assertEqual(original_add.expires_at, add.expires_at)
            for original, raw in ((original_add, original_add_bytes), (original_remove, original_remove_bytes)):
                recovered = changes.recover(original.pk)
                self.assertEqual(recovered.operation_id, original.operation_id)
                self.assertEqual(bytes(recovered.operation.current_attempt.raw_transaction), raw)
                self.assertEqual(recovered.status, "confirmed")
            self.assertEqual(SignedAttempt.objects.count(), 3)
            self.assertEqual(SigningAccount.objects.get(pk=self.signing_account.pk).next_nonce, nonce + 2)
        self.assertEqual(self.chain.w3.eth.get_transaction_count(self.signer, "pending"), nonce + 2)
        self.assertEqual(self.registry.functions.expiresAt(selected).call(), 0)
        self.assertEqual(self.contract.functions.totalSupply().call(), 0)
