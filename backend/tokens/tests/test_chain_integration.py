import csv
import io
import os
import secrets
import threading
import time
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from eth_account import Account
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from assets.models import Asset, AssetChainDeployment, AssetType
from blockchain.models import (
    BlockchainTransaction,
    SigningAccount,
    TransactionStatus,
    TransactionType,
)
from companies.models import Company, CompanyStatus
from integrations.base_chain.client import BaseChainClient, get_base_chain_client
from integrations.base_chain.exceptions import BaseChainTransactionError
from integrations.blockchain import BlockchainClientFactory
from shared.tests.tenants import make_tenant
from tokens.exceptions import IssuanceRefusedException, TokenDeploymentFailedException
from tokens.models import (
    CapitalIncreaseRequest,
    FormerHolder,
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
    ShareTokenStatus,
    TokenDeployment,
)
from tokens.services import deployment, share_token_service
from tokens.services.former_holders import fold_former_holders
from tokens.services.register import (
    IDENTITY_LABELS,
    IDENTITY_LIVE,
    REGISTER_HEADERS,
    SOURCE_CHAIN,
    SOURCE_LABELS,
)
from tokens.services.share_token_service import (
    EXCEEDS_AUTHORIZED,
    NOT_WHITELISTED,
    TOKEN_PAUSED,
)
from tokens.tasks import (
    check_executing_issuance_requests,
    check_pending_token_deployments,
    deploy_share_token_task,
    execute_review_request_task,
)
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.exceptions import BlockchainAPIError
from wallets.models import Holding, Wallet
from wallets.services.transfers import prepare_erc20_transaction
from whitelist.services import changes, whitelist

CHAIN_ENV = (
    "CHAIN_TEST_RPC_URL",
    "WHITELIST_CONTRACT_ADDRESS",
    "SHARE_TOKEN_FACTORY_ADDRESS",
    "STABLECOIN_CONTRACT_ADDRESS",
    "ATOMIC_SWAP_ADDRESS",
    "BLOCKCHAIN_OPERATOR_KEY",
)
CHAIN_SETTINGS = {
    "BLOCKCHAIN_RPC_URL": os.environ.get("CHAIN_TEST_RPC_URL", ""),
    "BLOCKCHAIN_CHAIN_ID": 31337,
    **{name: os.environ.get(name, "") for name in CHAIN_ENV[1:]},
}
CAP = 1000


chain_available = skipUnless(
    all(os.environ.get(name) for name in CHAIN_ENV), "CHAIN_TEST_RPC_URL and the core contract addresses"
)


class ChainTestMixin:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        get_base_chain_client.cache_clear()
        BaseChainClient._instance = None
        BaseChainClient._web3 = None

    def setUp(self):
        self.tenant = make_tenant("chain")
        Company.objects.filter(pk=self.tenant.company.pk).update(
            status=CompanyStatus.ACTIVE, acn=f"{secrets.randbelow(10**9):09d}"
        )
        self.token = ShareToken.objects.select_related("company").get(pk=self.tenant.token.pk)
        self.token.total_supply = str(CAP)
        self.token.save(update_fields=["total_supply"])
        self.service = share_token_service
        self.chain = get_base_chain_client()
        self.w3 = self.chain.w3
        snapshot = self.w3.provider.make_request("evm_snapshot", [])["result"]
        self.addCleanup(self.w3.provider.make_request, "evm_revert", [snapshot])
        self.staff = make_tenant("chain-staff", staff=True).user
        self.investor = Account.create().address
        Wallet.objects.create(
            user_account=self.tenant.account,
            address=self.investor,
            chain="base",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )

    def _contract(self):
        return self.service.load_share_token(self.token.contract_address)

    @property
    def identifier(self):
        return f"{self.token.company.acn}:{self.token.symbol}"

    def _signer_nonce(self):
        signer = self.chain.get_address_from_private_key(self.service.signer_key())
        return self.w3.eth.get_transaction_count(signer, "pending")

    def _deploy_records(self):
        return BlockchainTransaction.objects.filter(
            tx_type=TransactionType.SHARE_TOKEN_DEPLOY, related_uuid=self.token.uuid
        )

    @staticmethod
    def _crash_after_send():

        def crash(client, tx_hash, timeout=120):
            raise BaseChainTransactionError("worker crashed after send")

        return patch.object(BaseChainClient, "wait_for_receipt", crash)

    @staticmethod
    def _lost_receipt():
        real = BaseChainClient.wait_for_receipt

        def lose(client, tx_hash, timeout=120):
            real(client, tx_hash, timeout=timeout)
            raise BaseChainTransactionError("receipt lost after the transaction mined")

        return patch.object(BaseChainClient, "wait_for_receipt", lose)

    def _start_deployment(self):
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower()
        SigningAccount.objects.get_or_create(
            chain_id=31337, address=sender, defaults={"admission_state": "admitted", "admission_generation": 1}
        )
        with patch("tokens.tasks.deploy_share_token_task.defer"):
            deployment.start_deployment(self.token, principal_id=None)

    def _deployed(self):
        self._start_deployment()
        result = deploy_share_token_task(
            token_uuid=str(self.token.uuid), deployment_id=str(self.token.deployment_id), principal_id=None
        )
        self.assertTrue(result["success"], result)
        self.token.refresh_from_db()
        return result

    def _whitelist(self, address):
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower()
        SigningAccount.objects.get_or_create(
            chain_id=31337, address=sender, defaults={"admission_state": "admitted", "admission_generation": 1}
        )
        change = changes.submit(uuid4(), "add", address, self.staff)
        self.assertEqual(change.status, "confirmed")
        return change

    def _whitelisted_request(self, amount):
        self._whitelist(self.investor)
        return self._issuance_request(amount)

    def _issuance_request(self, amount):
        return ShareIssuanceRequest.objects.create(
            token=self.token,
            recipient_address=self.investor,
            recipient_name="Investor",
            amount=amount,
            reason="Allotment",
            status=RequestStatus.APPROVED,
            submitted_by=self.tenant.user,
            reviewed_by=self.staff,
        )

    def _execute(self, request):
        return execute_review_request_task(
            model_label=request._meta.label, request_uuid=str(request.uuid), executed_by=self.staff.pk
        )

    def _increase(self, additional, status=RequestStatus.APPROVED):
        return CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=additional,
            new_authorized_total=CAP + additional,
            purpose="Growth",
            board_resolution_reference=f"BOARD-{additional}",
            status=status,
        )


@chain_available
@override_settings(**CHAIN_SETTINGS)
class ShareTokenChainTest(ChainTestMixin, APITransactionTestCase):
    def test_real_unwhitelisted_and_paused_transfer_estimates_explain_the_refusal_without_sending(self):
        self._deployed()
        self.assertTrue(self._execute(self._whitelisted_request(10))["success"])
        self.w3.eth.wait_for_transaction_receipt(
            self.w3.eth.send_transaction(
                {"from": self.w3.eth.accounts[0], "to": self.investor, "value": self.w3.to_wei(1, "ether")}
            )
        )
        recipient = Account.create().address
        BlockchainClientFactory._clients.clear()
        self.addCleanup(BlockchainClientFactory._clients.clear)
        nonce = self.w3.eth.get_transaction_count(self.investor)

        def prepare():
            return prepare_erc20_transaction(
                "base",
                self.investor,
                recipient,
                Decimal("1"),
                Decimal("10"),
                Decimal("1"),
                self.token.contract_address,
                self.token.symbol,
                0,
            )

        with self.assertRaises(BlockchainAPIError) as refusal:
            prepare()
        self.assertEqual(str(refusal.exception.detail), "Recipient is not whitelisted for transfers")
        Wallet.objects.create(
            user_account=self.tenant.account,
            address=recipient,
            chain="base",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )
        self._whitelist(recipient)
        self.service.pause(self.token)
        with self.assertRaises(BlockchainAPIError) as refusal:
            prepare()
        self.assertEqual(str(refusal.exception.detail), "Token transfers are paused")
        self.assertEqual(self.w3.eth.get_transaction_count(self.investor), nonce)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)

    def test_a_transfer_sent_outside_the_platform_is_retained_in_the_former_member_register(self):
        investor = Account.create()
        Wallet.objects.filter(address=self.investor).update(address=investor.address)
        self.investor = investor.address
        self._deployed()
        self.assertTrue(self._execute(self._whitelisted_request(10))["success"])
        recipient = self.w3.eth.accounts[1]
        recipient_tenant = make_tenant("external-transfer-recipient")
        Wallet.objects.filter(pk=recipient_tenant.wallet.pk).update(
            address=recipient, verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
        )
        self._whitelist(recipient)
        self.w3.eth.wait_for_transaction_receipt(
            self.w3.eth.send_transaction(
                {"from": self.w3.eth.accounts[0], "to": investor.address, "value": self.w3.to_wei(1, "ether")}
            )
        )
        transfer = (
            self._contract()
            .functions.transfer(recipient, 10)
            .build_transaction(
                {
                    "from": investor.address,
                    "nonce": self.w3.eth.get_transaction_count(investor.address),
                    "chainId": 31337,
                }
            )
        )
        signed = investor.sign_transaction(transfer)
        receipt = self.w3.eth.wait_for_transaction_receipt(self.w3.eth.send_raw_transaction(signed.raw_transaction))
        self.assertEqual(receipt["status"], 1)
        start = self.service.deployment_block(self.token.deployment_tx_hash)
        entries = self.service.transfer_entries(self.token.contract_address, start, receipt["blockNumber"], window=1)
        self.assertEqual(
            [(entry["from"], entry["to"], entry["value"]) for entry in entries],
            [
                ("0x" + "0" * 40, investor.address, 10),
                (investor.address, recipient, 10),
            ],
        )
        result = fold_former_holders(self.token, reader=self.service)
        self.assertEqual(result["written"], 1)
        row = FormerHolder.objects.get(token=self.token)
        expected_date = datetime.fromtimestamp(
            self.w3.eth.get_block(receipt["blockNumber"])["timestamp"], tz=dt_timezone.utc
        ).date()
        self.assertEqual(
            (row.wallet_address, row.ceased_at_block, row.ceased_on, row.shares_at_cessation),
            (investor.address, receipt["blockNumber"], expected_date, 10),
        )
        self.assertEqual(row.name, self.tenant.profile.full_name)
        self.assertEqual(fold_former_holders(self.token, reader=self.service)["written"], 0)
        self.client.force_authenticate(self.tenant.user)
        response = self.client.get(f"/api/v1/tokens/{self.token.uuid}/holders/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["formerMembers"][0]["walletAddress"], investor.address)
        self.assertEqual(response.json()["formerMembers"][0]["sharesAtCessation"], "10")

    def test_deploy_whitelist_issue_increase_pause_and_redeploy(self):
        self._start_deployment()
        result = deploy_share_token_task(
            token_uuid=str(self.token.uuid), deployment_id=str(self.token.deployment_id), principal_id=None
        )
        self.token.refresh_from_db()
        contract_address = result["contract_address"]

        self.assertEqual(result["success"], True)
        self.assertEqual(result["adopted"], False)
        self.assertEqual(result["identifier"], self.identifier)
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertEqual(self.token.contract_address, contract_address)
        self.assertTrue(self.token.deployment_tx_hash.startswith("0x"), self.token.deployment_tx_hash)
        self.assertEqual(self.token.deployment_transaction.tx_hash, self.token.deployment_tx_hash)
        self.assertEqual(self.token.deployment_transaction.status, TransactionStatus.CONFIRMED)
        self.assertTrue(self.token.deployment_transaction.block_hash.startswith("0x"))
        self.assertEqual(self.token.deployment_transaction.function_name, "createShareToken")
        self.assertEqual(
            self.token.deployment_transaction.function_args["issuerWallet"], self.tenant.wallet.address.lower()
        )
        self.assertEqual(self.service.get_token_by_identifier(self.identifier), contract_address)
        self.assertEqual(self._contract().functions.totalSupply().call(), 0)
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP)
        self.assertFalse(ShareIssuance.objects.filter(token=self.token).exists())

        not_whitelisted = self._issuance_request(amount=10)
        blocks_before = self.w3.eth.block_number
        self.assertEqual(self._execute(not_whitelisted), {"success": False, "error": NOT_WHITELISTED})
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        not_whitelisted.refresh_from_db()
        self.assertEqual(not_whitelisted.status, RequestStatus.APPROVED)
        self.assertIn(f"Refused: {NOT_WHITELISTED}", not_whitelisted.execution_notes)
        self.assertNotIn("Refused", not_whitelisted.review_notes)

        change = self._whitelist(self.investor)
        tx_hash, entry = change.transaction.tx_hash, change.entry
        self.assertTrue(tx_hash)
        self.assertTrue(whitelist.is_whitelisted(self.investor))
        self.assertTrue(entry.is_whitelisted)

        too_many = self._issuance_request(amount=CAP + 1)
        blocks_before = self.w3.eth.block_number
        with self.assertRaisesMessage(IssuanceRefusedException, EXCEEDS_AUTHORIZED):
            self.service.execute_request(too_many, executed_by=self.staff)
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        too_many.refresh_from_db()
        self.assertEqual(too_many.status, RequestStatus.APPROVED)
        self.assertIn(f"Refused: {EXCEEDS_AUTHORIZED}", too_many.execution_notes)
        self.assertNotIn("Refused", too_many.review_notes)
        self.assertFalse(ShareIssuance.objects.filter(token=self.token).exists())

        executed = self._execute(not_whitelisted)
        self.assertTrue(executed["success"], executed)
        not_whitelisted.refresh_from_db()
        issuance = not_whitelisted.executed_issuance
        self.assertEqual(not_whitelisted.status, RequestStatus.EXECUTED)
        self.assertEqual(issuance.status, IssuanceStatus.COMPLETED)
        self.assertEqual(issuance.initiated_by, self.staff)
        self.assertEqual(issuance.tx_hash, executed["tx_hash"])
        self.assertTrue(issuance.tx_hash.startswith("0x"), issuance.tx_hash)
        self.assertEqual(self.w3.eth.get_transaction_receipt(issuance.tx_hash)["status"], 1)
        self.assertEqual(issuance.block_number, executed["block_number"])
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 10)
        self.token.refresh_from_db()
        self.assertEqual(self.token.total_supply, str(CAP))

        self.client.force_authenticate(self.tenant.user)
        holders = self.client.get(f"/api/v1/tokens/{self.token.uuid}/holders/")
        self.assertEqual(holders.status_code, 200)
        self.assertEqual(holders.json()["totalHolders"], 1)
        holder = holders.json()["holders"][0]
        self.assertEqual(
            {key: holder[key] for key in ("address", "name", "balance", "source", "percentage")},
            {
                "address": self.investor,
                "name": self.tenant.profile.full_name,
                "balance": "10",
                "source": "blockchain",
                "percentage": 100.0,
            },
        )
        self.assertEqual(holder["holderType"], "member")
        self.assertEqual(holder["shareClass"], self.token.symbol)
        self.assertIsNotNone(holder["enteredOn"])

        register = self.client.get(f"/api/v1/tokens/{self.token.uuid}/register/export/")
        self.assertEqual(register.status_code, 200)
        rows = list(csv.reader(io.StringIO(register.content.decode())))
        self.assertEqual(rows[0], REGISTER_HEADERS)
        row = dict(zip(REGISTER_HEADERS, rows[1]))
        self.assertEqual(row["Name"], self.tenant.profile.full_name)
        self.assertEqual(row["Residential address"], "")
        self.assertEqual(row["Wallet address"], self.investor)
        self.assertEqual(row["Holder type"], "Member")
        self.assertEqual(row["Class"], "DRF")
        self.assertEqual(row["Shares held"], "10")
        self.assertEqual(row["Balance source"], SOURCE_LABELS[SOURCE_CHAIN])
        self.assertEqual(row["Identity source"], IDENTITY_LABELS[IDENTITY_LIVE])
        self.assertEqual(row["Whitelist status"], "Active")
        self.assertEqual(row["Amount paid"], "")
        self.assertEqual(holders.json()["token"]["totalSupply"], str(CAP))

        increase = CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=500,
            new_authorized_total=CAP + 500,
            purpose="Growth",
            board_resolution_reference="BOARD-1",
            status=RequestStatus.APPROVED,
        )
        increased = self._execute(increase)
        self.assertTrue(increased["success"], increased)
        self.assertEqual(increased["new_authorized_total"], CAP + 500)
        increase.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual(increase.status, RequestStatus.EXECUTED)
        self.assertIsNone(increase.executed_issuance)
        self.assertEqual(self.token.total_supply, str(CAP + 500))
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 500)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)

        stale = CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=10,
            new_authorized_total=CAP + 10,
            purpose="Approved against the old cap",
            board_resolution_reference="BOARD-0",
            status=RequestStatus.APPROVED,
        )
        blocks_before = self.w3.eth.block_number
        refusal = self._execute(stale)
        self.assertFalse(refusal["success"])
        for detail in (str(CAP + 10), str(CAP + 500), str(increase.uuid)):
            self.assertIn(detail, refusal["error"])
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        stale.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual(
            (stale.status, stale.review_notes, stale.rejection_reason),
            (RequestStatus.SUPERSEDED, "", refusal["error"]),
        )
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 500)
        self.assertEqual(self.token.total_supply, str(CAP + 500))

        self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)
        self.assertTrue(self._contract().functions.paused().call())
        while_paused = self._issuance_request(amount=1)
        blocks_before = self.w3.eth.block_number
        self.assertEqual(self._execute(while_paused), {"success": False, "error": TOKEN_PAUSED})
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        while_paused.refresh_from_db()
        self.assertEqual(while_paused.status, RequestStatus.APPROVED)
        self.assertIn(f"Refused: {TOKEN_PAUSED}", while_paused.execution_notes)
        self.assertNotIn("Refused", while_paused.review_notes)
        self.assertEqual(ShareIssuance.objects.filter(token=self.token).count(), 1)
        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertFalse(self._contract().functions.paused().call())
        self.assertTrue(self._execute(while_paused)["success"])
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 11)

        blocks_before = self.w3.eth.block_number
        self.assertEqual(deployment.recover(self.token.deployment_id), contract_address)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertEqual(self.token.contract_address, contract_address)
        self.assertEqual(self.w3.eth.block_number, blocks_before)

    def test_a_real_deployment_bridges_a_verified_asset_and_an_allotment_writes_the_holding(self):
        BlockchainClientFactory._clients.clear()
        self.addCleanup(BlockchainClientFactory._clients.clear)
        contract_address = self._deployed()["contract_address"]

        self.assertEqual(self.service.get_token_by_identifier(self.identifier), contract_address)
        asset_deployment = AssetChainDeployment.objects.get(contract_address=contract_address)
        asset = asset_deployment.asset
        self.assertEqual((asset_deployment.chain, asset_deployment.decimals), ("base", 0))
        self.assertEqual(
            (asset.symbol, asset.asset_type, asset.decimals, asset.is_verified),
            (self.token.symbol, AssetType.TOKENIZED_SECURITY.value, 0, True),
        )
        self.assertEqual(asset.name, f"{self.token.company.name} {self.token.name}")
        self.assertIsNone(asset.current_price)

        self.assertEqual(deployment.recover(self.token.deployment_id), contract_address)
        self.assertEqual(AssetChainDeployment.objects.filter(contract_address=contract_address).count(), 1)
        self.assertEqual(Asset.objects.filter(chain_deployments__contract_address=contract_address).count(), 1)

        self.token.refresh_from_db()
        request = self._whitelisted_request(amount=40)
        self.assertTrue(self._execute(request)["success"])

        wallet = Wallet.objects.get(address=self.investor)
        holding = Holding.objects.get(wallet=wallet, asset=asset)
        self.assertEqual(holding.quantity, Decimal("40"))
        self.assertIsNotNone(holding.last_synced_at)
        self.assertIsNone(holding.market_value)
        snapshot = holding.snapshots.get()
        self.assertEqual((snapshot.quantity, snapshot.snapshot_reason), (Decimal("40"), "DAILY"))
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 40)

    def test_lost_deployment_receipt_keeps_the_original_hash_until_the_sweep_projects_it(self):
        self._start_deployment()
        nonce_before = self._signer_nonce()
        with patch.object(BaseChainClient, "get_transaction_receipt", return_value=None):
            result = deploy_share_token_task(
                token_uuid=str(self.token.pk), deployment_id=str(self.token.deployment_id), principal_id=None
            )
        self.assertFalse(result["success"])
        self.token.refresh_from_db()
        record = self._deploy_records().get()
        self.assertEqual((self.token.status, self.token.contract_address), (ShareTokenStatus.DEPLOYING, None))
        self.assertEqual((self.token.deployment_tx_hash, record.status), (record.tx_hash, TransactionStatus.SUBMITTED))
        self.assertEqual(self._signer_nonce(), nonce_before + 1)
        self.assertEqual(check_pending_token_deployments(), {"checked": 0, "resolved": 0})
        TokenDeployment.objects.filter(pk=self.token.deployment_id).update(
            updated_at=timezone.now() - timedelta(hours=1)
        )
        self.assertEqual(check_pending_token_deployments(), {"checked": 1, "resolved": 1})
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertEqual(self.token.contract_address, self.service.get_token_by_identifier(self.identifier))
        self.assertEqual(self._deploy_records().count(), 1)
        record.refresh_from_db()
        self.assertEqual(record.status, TransactionStatus.CONFIRMED)
        self.assertEqual(record.block_number, self.w3.eth.get_transaction_receipt(record.tx_hash)["blockNumber"])
        self.assertEqual(self._contract().functions.totalSupply().call(), 0)

    def test_retry_recovers_real_pending_bytes_and_receipt_without_another_deployment(self):
        from blockchain.models import SignedAttempt

        rpc = self.w3.provider.make_request

        def restore_mining():
            rpc("evm_setAutomine", [True])
            rpc("evm_mine", [])

        self.addCleanup(restore_mining)
        self._start_deployment()
        rpc("evm_setAutomine", [False])
        nonce_before = self._signer_nonce()
        self.assertIsNone(deployment.deploy_token(self.token)["contract_address"])
        attempt = SignedAttempt.objects.get()
        self.assertIsNone(deployment.recover(self.token.deployment_id))
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self._signer_nonce(), nonce_before + 1)
        self.assertIsNone(self.chain.get_transaction_receipt(attempt.tx_hash))
        restore_mining()
        self.assertEqual(
            deployment.recover(self.token.deployment_id), self.service.get_token_by_identifier(self.identifier)
        )
        self.token.refresh_from_db()
        self.assertEqual(self.token.deployment_tx_hash, attempt.tx_hash)
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertEqual(self._contract().functions.totalSupply().call(), 0)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_deployment_worker_killed_after_real_node_acceptance_recovers_original_signed_bytes(self):
        import json
        import signal
        import subprocess
        import sys

        from django.db import connections

        from blockchain.models import SignedAttempt
        from blockchain.tests.test_outgoing_processes import finish
        from shared.db import current_alias

        self._start_deployment()
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["DEPLOYMENT_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        env["DEPLOYMENT_TEST_CHAIN"] = json.dumps(CHAIN_SETTINGS)
        nonce = self._signer_nonce()
        process = subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.deployment_chain_worker", str(self.token.pk)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        original = SignedAttempt.objects.get()
        self.assertEqual(original.nonce, nonce)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYING)
        self.assertEqual(self.token.deployment_tx_hash, original.tx_hash)
        with patch("tokens.services.share_token_service._approve_for_swap"):
            address = deployment.recover(self.token.deployment_id)
        self.assertEqual(address, self.service.get_token_by_identifier(self.identifier))
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        observed = self.w3.eth.get_transaction(original.tx_hash)
        command = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertEqual(bytes(observed["input"]), bytes.fromhex(command.intent["data"][2:]))
        self.assertEqual(observed["nonce"], original.nonce)
        self.assertEqual(command.transaction.tx_hash, original.tx_hash)

    def test_lost_mint_receipt_is_resumed_on_retry_instead_of_minted_again(self):
        self._deployed()
        request = self._whitelisted_request(amount=10)

        with self._lost_receipt():
            with self.assertRaisesMessage(BaseChainTransactionError, "receipt lost after the transaction mined"):
                self._execute(request)

        request.refresh_from_db()
        issuance = ShareIssuance.objects.get(token=self.token)
        self.assertEqual(request.status, RequestStatus.FAILED)
        self.assertTrue(request.can_be_executed)
        self.assertEqual(
            (issuance.status, issuance.idempotency_key), (IssuanceStatus.FAILED, f"issuance-request:{request.uuid}")
        )
        self.assertTrue(issuance.tx_hash.startswith("0x"), issuance.tx_hash)
        self.assertEqual(self.w3.eth.get_transaction_receipt(issuance.tx_hash)["status"], 1)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 0)

        nonce_before = self._signer_nonce()
        with patch.object(BaseChainClient, "wait_for_receipt", side_effect=AssertionError("nothing to wait for")):
            retried = self._execute(request)

        self.assertTrue(retried["success"], retried)
        self.assertEqual(retried["tx_hash"], issuance.tx_hash)
        self.assertEqual(self._signer_nonce(), nonce_before)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        request.refresh_from_db()
        issuance.refresh_from_db()
        self.assertEqual(list(ShareIssuance.objects.filter(token=self.token)), [issuance])
        self.assertEqual((issuance.status, issuance.block_number), (IssuanceStatus.COMPLETED, retried["block_number"]))
        self.assertEqual((request.status, request.executed_issuance), (RequestStatus.EXECUTED, issuance))
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 10)

    def test_a_mint_journaled_before_a_failed_send_is_replayed_on_the_same_nonce(self):
        self._deployed()
        request = self._whitelisted_request(amount=10)
        nonce_before = self._signer_nonce()
        with patch.object(
            BaseChainClient, "send_raw_transaction", side_effect=ConnectionError("send never reached node")
        ):
            with self.assertRaisesMessage(ConnectionError, "send never reached node"):
                self._execute(request)
        issuance = ShareIssuance.objects.get(token=self.token)
        raw = Web3.to_bytes(hexstr=issuance.mint_journal[-1]["raw_transaction"])
        self.assertEqual(issuance.tx_hash, Web3.to_hex(Web3.keccak(raw)))
        self.assertEqual(self._signer_nonce(), nonce_before)
        self.assertEqual(self._contract().functions.totalSupply().call(), 0)
        self.assertIsNone(self.chain.get_transaction_receipt(issuance.tx_hash))

        request.refresh_from_db()
        with patch.object(BaseChainClient, "sign_transaction", side_effect=AssertionError("must replay saved bytes")):
            result = self._execute(request)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["tx_hash"], issuance.tx_hash)
        self.assertEqual(self._signer_nonce(), nonce_before + 1)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)

    def test_a_lost_send_response_is_reconciled_to_the_original_mint(self):
        self._deployed()
        request = self._whitelisted_request(amount=10)
        nonce_before = self._signer_nonce()
        actual_send = self.chain.send_raw_transaction

        def send_then_lose_response(raw):
            actual_send(raw)
            raise ConnectionError("send response lost")

        with patch.object(BaseChainClient, "send_raw_transaction", side_effect=send_then_lose_response):
            with self.assertRaisesMessage(ConnectionError, "send response lost"):
                self._execute(request)
        issuance = ShareIssuance.objects.get(token=self.token)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(self._signer_nonce(), nonce_before + 1)
        self.assertEqual(self.w3.eth.get_transaction_receipt(issuance.tx_hash)["status"], 1)

        request.refresh_from_db()
        with patch.object(
            BaseChainClient, "sign_transaction", side_effect=AssertionError("must not sign another mint")
        ):
            result = self._execute(request)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["tx_hash"], issuance.tx_hash)
        self.assertEqual(self._signer_nonce(), nonce_before + 1)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)

    def test_lost_set_authorized_receipt_is_resumed_on_retry_instead_of_refusing_the_increase(self):
        self._deployed()
        increase = self._increase(500)

        with self._lost_receipt():
            with self.assertRaisesMessage(TokenDeploymentFailedException, "The capital increase is unconfirmed."):
                self._execute(increase)

        increase.refresh_from_db()
        self.token.refresh_from_db()
        record = BlockchainTransaction.objects.get(
            related_model="tokens.CapitalIncreaseRequest", related_uuid=increase.uuid
        )
        self.assertEqual((increase.status, self.token.total_supply), (RequestStatus.FAILED, str(CAP)))
        self.assertTrue(increase.can_be_executed)
        self.assertEqual((record.status, record.function_name), (TransactionStatus.FAILED, "setAuthorizedShares"))
        self.assertTrue(record.tx_hash.startswith("0x"), record.tx_hash)
        self.assertEqual(self.w3.eth.get_transaction_receipt(record.tx_hash)["status"], 1)
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 500)

        nonce_before = self._signer_nonce()
        with patch.object(BaseChainClient, "wait_for_receipt", side_effect=AssertionError("nothing to wait for")):
            retried = self._execute(increase)

        self.assertTrue(retried["success"], retried)
        self.assertEqual((retried["tx_hash"], retried["new_authorized_total"]), (record.tx_hash, CAP + 500))
        self.assertEqual(self._signer_nonce(), nonce_before)
        increase.refresh_from_db()
        record.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual((increase.status, increase.executed_issuance), (RequestStatus.EXECUTED, None))
        self.assertEqual(self.token.total_supply, str(CAP + 500))
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 500)
        self.assertEqual((record.status, record.block_number), (TransactionStatus.CONFIRMED, retried["block_number"]))
        self.assertEqual(BlockchainTransaction.objects.filter(related_model="tokens.CapitalIncreaseRequest").count(), 1)

        again = self._increase(600)
        self.assertTrue(self._execute(again)["success"])
        self.token.refresh_from_db()
        self.assertEqual(self.token.total_supply, str(CAP + 600))
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 600)

    def test_lost_pause_receipt_and_an_outside_pause_are_reconciled_instead_of_stranding_the_token(self):
        self._deployed()
        contract = self._contract()

        with self._lost_receipt():
            self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)
        self.assertTrue(contract.functions.paused().call())

        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertFalse(contract.functions.paused().call())

        self.chain.send_transaction(contract.functions.pause(), self.service.signer_key())
        self.assertTrue(contract.functions.paused().call())
        nonce_before = self._signer_nonce()
        self.service.pause(self.token)
        self.token.refresh_from_db()
        self.assertEqual((self.token.status, self._signer_nonce()), (ShareTokenStatus.PAUSED, nonce_before))

        ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.DEPLOYED)
        self.token.refresh_from_db()
        request = self._whitelisted_request(amount=5)
        blocks_before = self.w3.eth.block_number
        self.assertEqual(self._execute(request), {"success": False, "error": TOKEN_PAUSED})
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        self.service.unpause(self.token)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertFalse(contract.functions.paused().call())

        self.assertTrue(self._execute(request)["success"])
        self.assertEqual(contract.functions.balanceOf(self.investor).call(), 5)

    def test_worker_killed_after_the_mint_is_finished_by_the_executing_sweep(self):
        self._deployed()
        request = self._whitelisted_request(amount=10)

        with patch.object(share_token_service, "_complete_issuance", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self._execute(request)

        request.refresh_from_db()
        issuance = ShareIssuance.objects.get(token=self.token)
        self.assertEqual((request.status, issuance.status), (RequestStatus.EXECUTING, IssuanceStatus.PROCESSING))
        self.assertFalse(request.can_be_executed)
        self.assertTrue(issuance.tx_hash.startswith("0x"), issuance.tx_hash)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 0)

        self.assertEqual(check_executing_issuance_requests(), {"checked": 0, "resolved": 0})
        ShareIssuanceRequest.objects.filter(pk=request.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        nonce_before = self._signer_nonce()
        self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 1})

        self.assertEqual(self._signer_nonce(), nonce_before)
        request.refresh_from_db()
        issuance.refresh_from_db()
        self.assertEqual(list(ShareIssuance.objects.filter(token=self.token)), [issuance])
        self.assertEqual((request.status, request.executed_issuance), (RequestStatus.EXECUTED, issuance))
        self.assertEqual(issuance.status, IssuanceStatus.COMPLETED)
        self.assertEqual(issuance.block_number, self.w3.eth.get_transaction_receipt(issuance.tx_hash)["blockNumber"])
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 10)


@chain_available
@override_settings(**CHAIN_SETTINGS)
class ShareTokenChainConcurrencyTest(ChainTestMixin, APITransactionTestCase):

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("select_for_update is a no-op on SQLite")
        super().setUp()

    def _wait_until(self, condition, timeout=15):
        deadline = time.monotonic() + timeout
        while not condition():
            self.assertLess(time.monotonic(), deadline, "timed out waiting on the chain")
            time.sleep(0.05)

    def test_two_workers_on_one_increase_send_one_transaction(self):
        self._deployed()
        increase = self._increase(1000)
        nonce_before = self._signer_nonce()
        results = {}

        def worker(name):
            try:
                results[name] = self._execute(increase)
            except Exception as exc:
                results[name] = exc
            finally:
                connection.close()

        first = threading.Thread(target=worker, args=("first",))
        second = threading.Thread(target=worker, args=("second",))
        first.start()
        second.start()
        first.join(timeout=60)
        second.join(timeout=60)

        self.assertFalse(first.is_alive() or second.is_alive(), results)
        succeeded = sorted(bool(value.get("success")) for value in results.values())
        self.assertEqual(succeeded, [False, True], results)
        refused = [value for value in results.values() if not value.get("success")][0]
        self.assertIn("Cannot execute request with status", refused["error"])
        self.assertEqual(self._signer_nonce(), nonce_before + 1)
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 1000)
        increase.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual((increase.status, self.token.total_supply), (RequestStatus.EXECUTED, str(CAP + 1000)))

    def test_a_later_increase_that_would_not_raise_the_cap_is_refused(self):
        self._deployed()
        big = self._increase(1000)

        self.assertTrue(self._execute(big)["success"])

        small = self._increase(50)
        result = self._execute(small)

        self.assertFalse(result["success"])
        for detail in (str(CAP + 50), str(CAP + 1000), str(big.uuid)):
            self.assertIn(detail, result["error"])
        small.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual(small.status, RequestStatus.SUPERSEDED)
        self.assertEqual(small.rejection_reason, result["error"])
        self.assertEqual(small.review_notes, "")
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 1000)
        self.assertEqual(self.token.total_supply, str(CAP + 1000))

    def test_resuming_a_failed_increase_while_another_is_in_flight_is_refused_with_a_reason(self):
        self._deployed()
        stalled = self._increase(1000, status=RequestStatus.FAILED)
        self._increase(50)
        nonce_before = self._signer_nonce()

        result = self._execute(stalled)

        stalled.refresh_from_db()
        self.assertFalse(result["success"], result)
        self.assertIn("has another capital increase in flight", result["error"])
        self.assertIn("has another capital increase in flight", stalled.execution_notes)
        self.assertEqual(stalled.review_notes, "")
        self.assertEqual(stalled.status, RequestStatus.FAILED)
        self.assertEqual(self._signer_nonce(), nonce_before)
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP)


@chain_available
@override_settings(**CHAIN_SETTINGS)
class MintRequestChainTest(APITransactionTestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model

        from blockchain.tests.outgoing_fixtures import admitted_signer
        from tokens.tests.mint_request_fixtures import mint_request

        get_base_chain_client.cache_clear()
        BaseChainClient._instance = None
        BaseChainClient._web3 = None
        self.chain = get_base_chain_client()
        self.w3 = self.chain.w3
        snapshot = self.w3.provider.make_request("evm_snapshot", [])["result"]
        self.addCleanup(self.w3.provider.make_request, "evm_revert", [snapshot])
        self.actor = get_user_model().objects.create_superuser(email="chain-mint@example.test", password="synthetic")
        self.request = mint_request(self.actor)
        AssetChainDeployment.objects.filter(asset=self.request.settlement_asset).update(
            contract_address=CHAIN_SETTINGS["STABLECOIN_CONTRACT_ADDRESS"]
        )
        self.signer = Account.from_key(CHAIN_SETTINGS["BLOCKCHAIN_OPERATOR_KEY"]).address
        admitted_signer(sender=self.signer)
        self.contract = self.chain.load_contract("AUDY", CHAIN_SETTINGS["STABLECOIN_CONTRACT_ADDRESS"])
        self.recipient = Web3.to_checksum_address(self.request.recipient_address)

    def test_node_acceptance_with_lost_response_mints_once_and_records_the_original_hash(self):
        from blockchain.models import SignedAttempt, SigningAccount
        from tokens.services import mint_service

        before_balance = self.contract.functions.balanceOf(self.recipient).call()
        before_nonce = self.w3.eth.get_transaction_count(self.signer, "pending")
        send = BaseChainClient.send_raw_transaction
        observed = []

        def lose_ack(client, raw):
            observed.append(send(client, raw))
            raise ConnectionError("Synthetic lost node response after acceptance")

        with patch.object(BaseChainClient, "send_raw_transaction", lose_ack):
            mint_service.execute(self.request, self.actor)
        self.assertEqual(self.request.status, "executed")
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        attempt = SignedAttempt.objects.get()
        self.assertEqual(observed, [attempt.tx_hash])
        self.assertEqual(self.request.transaction.tx_hash, attempt.tx_hash)
        self.assertEqual(self.contract.functions.balanceOf(self.recipient).call(), before_balance + self.request.amount)
        self.assertEqual(self.w3.eth.get_transaction_count(self.signer, "pending"), before_nonce + 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, before_nonce + 1)

    def test_pending_original_payload_recovers_after_mining_without_another_nonce(self):
        from blockchain.models import SignedAttempt
        from tokens.services import mint_service

        before_balance = self.contract.functions.balanceOf(self.recipient).call()
        before_nonce = self.w3.eth.get_transaction_count(self.signer, "pending")
        self.w3.provider.make_request("evm_setAutomine", [False])
        self.addCleanup(self.w3.provider.make_request, "evm_setAutomine", [True])
        mint_service.execute(self.request, self.actor)
        self.assertEqual(self.request.status, "executing")
        original = SignedAttempt.objects.get()
        self.assertEqual(mint_service.recover(self.request.pk), "executing")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.w3.provider.make_request("evm_mine", [])
        self.assertEqual(mint_service.recover(self.request.pk), "executed")
        self.request.refresh_from_db()
        self.assertEqual(self.request.transaction.tx_hash, original.tx_hash)
        self.assertEqual(self.contract.functions.balanceOf(self.recipient).call(), before_balance + self.request.amount)
        self.assertEqual(self.w3.eth.get_transaction_count(self.signer, "pending"), before_nonce + 1)


@chain_available
@override_settings(**CHAIN_SETTINGS)
class WhitelistChangeChainTest(ChainTestMixin, APITransactionTestCase):
    def test_old_submission_replay_preserves_later_chain_membership(self):
        original = self._whitelist(self.investor)
        removed = changes.submit(uuid4(), "remove", self.investor, self.staff)
        self.assertEqual(removed.status, "confirmed")
        nonce = self._signer_nonce()
        repeated = changes.submit(original.pk, "add", self.investor, self.staff)
        self.assertEqual(repeated.transaction_id, original.transaction_id)
        self.assertFalse(whitelist.is_whitelisted(self.investor))
        self.assertEqual(self._signer_nonce(), nonce)
        self._whitelist(self.investor)
        self.assertTrue(whitelist.is_whitelisted(self.investor))
        self.assertEqual(self._signer_nonce(), nonce + 1)

    def test_process_death_after_real_node_acceptance_recovers_exact_original_transaction(self):
        import json
        import signal
        import subprocess
        import sys

        from django.db import connections

        from blockchain.models import SignedAttempt
        from blockchain.tests.test_outgoing_processes import finish
        from shared.db import current_alias
        from whitelist.models import WhitelistChange

        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower()
        SigningAccount.objects.create(
            chain_id=31337, address=sender, admission_state="admitted", admission_generation=1
        )
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["WHITELIST_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        env["WHITELIST_TEST_CHAIN"] = json.dumps(CHAIN_SETTINGS)
        submission_id = uuid4()
        nonce = self._signer_nonce()
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "whitelist.tests.change_chain_worker",
                str(submission_id),
                str(self.staff.pk),
                self.investor,
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        original = SignedAttempt.objects.get()
        self.assertEqual(original.nonce, nonce)
        self.assertEqual(WhitelistChange.objects.get().status, "executing")
        self.assertTrue(whitelist.is_whitelisted(self.investor))
        recovered = changes.recover(submission_id)
        self.assertEqual(recovered.status, "confirmed")
        self.assertEqual(recovered.transaction.tx_hash, original.tx_hash)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        observed = self.w3.eth.get_transaction(original.tx_hash)
        self.assertEqual(bytes(observed["input"]), bytes.fromhex(recovered.intent["data"][2:]))
        self.assertEqual(observed["nonce"], original.nonce)
        self.assertEqual(Account.recover_transaction(bytes(original.raw_transaction)).lower(), sender)
