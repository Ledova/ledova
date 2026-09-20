import csv
import io
import json
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth.models import Permission
from django.db import connection, connections
from django.test import override_settings
from django.utils import timezone
from eth_account import Account
from eth_account.messages import encode_typed_data
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from assets.models import Asset, AssetChainDeployment, AssetType
from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
    TransactionStatus,
    TransactionType,
)
from blockchain.tests.test_outgoing_processes import finish
from companies.models import Company, CompanyStatus
from feature_flags.models import FeatureFlag
from integrations.base_chain.client import BaseChainClient, get_base_chain_client
from integrations.base_chain.exceptions import BaseChainTransactionError
from integrations.blockchain import BlockchainClientFactory
from operators.models import Operator
from shared.db import current_alias
from shared.tests.tenants import make_tenant
from shared.utils.typed_data import signable_message
from tokens.constants import MAX_UINT256
from tokens.exceptions import (
    CapitalIncreaseConflict,
    IssuanceExecutionConflict,
)
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    FormerHolder,
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareToken,
    ShareTokenStatus,
    SwapApprovalSubmission,
    SwapOrder,
    TokenDeployment,
    TransferOrder,
    TransferOrderType,
    YieldToken,
)
from tokens.services import (
    approval_submissions,
    atomic_swap_service,
    capital_execution,
    deployment,
    issuance_execution,
    nav,
    nav_recovery,
    pause_changes,
    pause_recovery,
    register_snapshot,
    share_token_service,
    swap_approval,
    swap_execution,
    token_transfer_service,
)
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
    recover_swap_approval_submissions,
)
from tokens.tests.deployment_fixtures import delete_approval_jobs
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
    "WALLET_CHAIN_FINALITY_POLICIES": {"evm:31337": {"mode": "depth", "depth": 1}},
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
        self.staff.user_permissions.add(
            *Permission.objects.filter(
                codename__in=("change_capitalincreaserequest", "change_shareissuancerequest", "change_subscription")
            )
        )
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
        signer = self.chain.get_address_from_private_key(settings.BLOCKCHAIN_OPERATOR_KEY)
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
        self.addCleanup(delete_approval_jobs, self.token.deployment_id)

    def _deployed(self):
        self._start_deployment()
        result = deploy_share_token_task(
            token_uuid=str(self.token.uuid), deployment_id=str(self.token.deployment_id), principal_id=None
        )
        self.assertTrue(result["success"], result)
        self.token.refresh_from_db()
        return result

    def _pause(self, paused):
        self.token.refresh_from_db()
        change = pause_changes.submit(self.token, self.tenant.user, uuid4(), paused)
        result = pause_recovery.recover(change.pk)
        self.assertIsNotNone(result.completed_at)
        self.assertIn(result.status, ("confirmed", "observed"))
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
        service = capital_execution if isinstance(request, CapitalIncreaseRequest) else issuance_execution
        try:
            confirmed = service.confirmation(request, self.staff)
            with patch("tokens.tasks.execute_review_request_task.defer"):
                command = service.admit(request, self.staff, confirmed=confirmed)
        except (CapitalIncreaseConflict, IssuanceExecutionConflict) as exc:
            return {"success": False, "error": str(exc.detail)}
        return execute_review_request_task(
            model_label=request._meta.label,
            request_uuid=str(request.uuid),
            executed_by=self.staff.pk,
            execution_id=str(command.pk),
        )

    @staticmethod
    def _missing_issuance_receipts():
        return patch.object(BaseChainClient, "get_transaction_receipt", return_value=None)

    def _increase(self, additional):
        return CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=additional,
            new_authorized_total=CAP + additional,
            purpose="Growth",
            board_resolution_reference=f"BOARD-{additional}",
            status=RequestStatus.APPROVED,
        )


@chain_available
@override_settings(**CHAIN_SETTINGS)
class SettlementServiceChainTest(ChainTestMixin, APITransactionTestCase):
    def setUp(self):
        from tokens.tests.swap_state_fixtures import BUYER, SELLER

        super().setUp()
        self.seller = SELLER
        self.buyer = BUYER
        self.investor = self.seller.address
        self.buyer_tenant = make_tenant("chain-buyer", with_swap=False)
        self.party_accounts = {self.seller.address: self.tenant.account, self.buyer.address: self.buyer_tenant.account}
        self.party_wallets = {
            party.address: Wallet.objects.create(
                user_account=self.party_accounts[party.address],
                address=party.address,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
            )
            for party in (self.seller, self.buyer)
        }
        self._deployed()
        self.assertEqual(swap_approval.recover(self.token.deployment_id), "confirmed")
        request = self._whitelisted_request(20)
        self.assertTrue(self._execute(request)["success"])
        self._whitelist(self.buyer.address)
        self.payment = self.chain.load_contract("AUDY", settings.STABLECOIN_CONTRACT_ADDRESS)
        _hash, receipt = self.chain.send_transaction(
            self.payment.functions.mint(self.buyer.address, 50000), private_key=settings.BLOCKCHAIN_OPERATOR_KEY
        )
        self.assertEqual(receipt["status"], 1)
        AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(
            contract_address=settings.STABLECOIN_CONTRACT_ADDRESS, decimals=2
        )
        for party in (self.seller, self.buyer):
            transaction = self.w3.eth.send_transaction(
                {"from": self.w3.eth.accounts[0], "to": party.address, "value": 10**18}
            )
            self.assertEqual(self.w3.eth.wait_for_transaction_receipt(transaction)["status"], 1)

    def balances(self):
        share = self._contract()
        return (
            share.functions.balanceOf(self.seller.address).call(),
            share.functions.balanceOf(self.buyer.address).call(),
            self.payment.functions.balanceOf(self.seller.address).call(),
            self.payment.functions.balanceOf(self.buyer.address).call(),
        )

    def test_prepared_and_broadcast_transfer_moves_the_exact_signed_shares(self):
        before = self.balances()
        nonce = self.w3.eth.get_transaction_count(self.seller.address)
        transaction = token_transfer_service.prepare_transfer(self.token, self.seller.address, self.buyer.address, 3)
        raw = self.chain.sign_transaction(transaction, self.seller.key)
        expected_hash = Web3.to_hex(Web3.keccak(raw))
        returned_hash, receipt = token_transfer_service.broadcast_transfer(Web3.to_hex(raw))
        self.assertEqual(returned_hash, expected_hash)
        self.assertEqual(Web3.to_hex(receipt["transactionHash"]), expected_hash)
        self.assertEqual(receipt["status"], 1)
        self.assertEqual(self.w3.eth.get_transaction_count(self.seller.address), nonce + 1)
        self.assertEqual(self.balances(), (before[0] - 3, before[1] + 3, before[2], before[3]))

    def matched_swap(self):
        Asset.objects.filter(pk=self.tenant.refs.stablecoin.pk).update(decimals=6)
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        orders = []
        for party, kind in ((self.seller, TransferOrderType.SELL), (self.buyer, TransferOrderType.BUY)):
            wallet = self.party_wallets[party.address]
            orders.append(
                TransferOrder.objects.create(
                    token=self.token,
                    payment_asset=self.tenant.refs.stablecoin,
                    wallet=wallet,
                    owner_account=self.party_accounts[party.address],
                    wallet_address=party.address,
                    order_type=kind,
                    quantity=10,
                    price_per_share=Decimal("1.50"),
                )
            )
        swap = token_transfer_service.match_orders(orders[1], orders[0], 3)["swap_order"]
        self.assertEqual((swap.share_amount, swap.payment_amount), (3, 450))
        return swap, orders

    def approval_route(self, swap, order):
        identity = {
            "swap_uuid": str(swap.pk),
            "owner_account_uuid": str(order.owner_account_id),
            "wallet_uuid": str(order.wallet_id),
            "settlement_digest": swap.settlement_digest,
        }
        return f"/api/v1/trading/orders/{order.pk}/swap", identity

    def signed_approval(self, swap, order, party):
        url, identity = self.approval_route(swap, order)
        self.client.force_authenticate(self.party_accounts[party.address].user_profile.user)
        prepared = self.client.get(url + "/approval-data/", identity)
        self.assertEqual(prepared.status_code, 200, prepared.content)
        self.assertTrue(prepared.json()["needsApproval"])
        transaction = {
            key: int(value, 16) if key in ("value", "gas", "gasPrice", "nonce", "chainId") else value
            for key, value in prepared.json()["transaction"].items()
            if key != "from"
        }
        return bytes(self.chain.sign_transaction(transaction, party.key))

    def broadcast_approval(self, swap, order, raw):
        url, identity = self.approval_route(swap, order)
        return self.client.post(
            url + "/approval-broadcast/", {**identity, "signed_transaction": Web3.to_hex(raw)}, format="json"
        )

    def admit_swap(self):
        swap, orders = self.matched_swap()
        typed_data = atomic_swap_service.get_typed_data(swap)
        self.assertEqual(typed_data["message"]["paymentAmount"], "450")
        self.assertEqual(swap.settlement_context["payment_asset"]["pricing_decimals"], 6)
        self.assertEqual(swap.settlement_context["payment_asset"]["deployment_decimals"], 2)
        for party, order in ((self.seller, orders[0]), (self.buyer, orders[1])):
            raw = self.signed_approval(swap, order, party)
            response = self.broadcast_approval(swap, order, raw)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()["txHash"], Web3.to_hex(Web3.keccak(raw)))
            recorded = SwapApprovalSubmission.objects.get(tx_hash=response.json()["txHash"])
            self.assertEqual((recorded.outcome, recorded.block_number), ("confirmed", response.json()["blockNumber"]))
        allowances = atomic_swap_service.check_swap_allowances(swap)
        self.assertTrue(allowances["seller"]["has_sufficient_allowance"])
        self.assertTrue(allowances["buyer"]["has_sufficient_allowance"])
        nonce = self._signer_nonce()
        signable = encode_typed_data(full_message=typed_data)
        first = swap_execution.submit_signature(
            swap,
            self.seller.sign_message(signable).signature.hex(),
            self.seller.address,
            user=self.tenant.user,
            participant="seller",
        )
        self.assertEqual(first.status, "seller_signed")
        completed = swap_execution.submit_signature(
            first,
            self.buyer.sign_message(signable).signature.hex(),
            self.buyer.address,
            user=self.buyer_tenant.user,
            participant="buyer",
        )
        self.assertEqual(completed.status, "executing")
        self.assertEqual(self._signer_nonce(), nonce)
        return completed

    def test_matching_approval_signing_and_execution_preserve_one_settlement(self):
        completed = self.admit_swap()
        before = self.balances()
        nonce = self._signer_nonce()
        self.assertEqual(swap_execution.recover(completed.transaction_id), "confirmed")
        completed.refresh_from_db()
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(self.balances(), (before[0] - 3, before[1] + 3, before[2] + 450, before[3] - 450))
        self.assertEqual(completed.transaction.function_args["paymentAmount"], "450")
        self.assertEqual(completed.transaction.tx_hash, completed.tx_hash)
        self.assertEqual(completed.transaction.status, TransactionStatus.CONFIRMED)
        self.assertEqual(completed.status, "executing")
        self.assertIsNone(completed.completed_at)
        self.assertEqual(
            [
                order.filled_quantity
                for order in TransferOrder.objects.filter(pk__in=[completed.sell_order_id, completed.buy_order_id])
            ],
            [3, 3],
        )
        operation = completed.transaction.outgoing_operation
        original = operation.current_attempt
        self.assertEqual(original.tx_hash, completed.tx_hash)
        self.assertEqual(
            bytes(self.w3.eth.get_transaction(original.tx_hash)["input"]), bytes.fromhex(operation.intent["data"][2:])
        )
        self.assertEqual(swap_execution.recover(completed.transaction_id), "confirmed")
        self.assertEqual(operation.attempts.count(), 1)
        self.assertEqual(self._signer_nonce(), nonce + 1)

    def test_real_swap_reinclusion_records_final_block_and_keeps_both_first_receipts(self):
        swap = self.admit_swap()
        balances = self.balances()
        before = self.w3.provider.make_request("evm_snapshot", [])["result"]
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES={"evm:31337": {"mode": "depth", "depth": 2}}):
            self.assertEqual(swap_execution.recover(swap.transaction_id), "confirmed")
            swap.refresh_from_db()
            operation = swap.transaction.outgoing_operation
            attempt = operation.current_attempt
            original_block = (operation.block_number, operation.block_hash)
            self.assertIsNone(swap_execution.settle(swap.transaction_id))
            swap.refresh_from_db()
            self.assertIsNone(swap.finalized_receipt)
            self.assertTrue(self.w3.provider.make_request("evm_revert", [before])["result"])
            self.assertEqual(self.balances(), balances)
            self.assertIsNone(swap_execution.settle(swap.transaction_id))
            self.w3.provider.make_request("evm_mine", [])
            self.assertEqual(
                Web3.to_hex(self.w3.eth.send_raw_transaction(bytes(attempt.raw_transaction))), attempt.tx_hash
            )
            receipt = self.w3.eth.wait_for_transaction_receipt(attempt.tx_hash)
            self.assertNotEqual((receipt["blockNumber"], Web3.to_hex(receipt["blockHash"])), original_block)
            self.w3.provider.make_request("evm_mine", [])
            self.assertEqual(swap_execution.settle(swap.transaction_id), "completed")
            swap.refresh_from_db()
            self.assertEqual(
                swap.finalized_receipt,
                {
                    "block_number": receipt["blockNumber"],
                    "block_hash": Web3.to_hex(receipt["blockHash"]),
                    "gas_used": receipt["gasUsed"],
                    "policy": {"version": 1, "mode": "depth", "depth": 2},
                },
            )
            self.assertIsNone(swap_execution.settle(swap.transaction_id))
            self.assertEqual(swap_execution.recover(swap.transaction_id), "confirmed")
        operation.refresh_from_db()
        record = BlockchainTransaction.objects.get(pk=swap.transaction_id)
        self.assertEqual((record.block_number, record.block_hash), original_block)
        self.assertEqual((operation.block_number, operation.block_hash), original_block)
        self.assertEqual(operation.attempts.count(), 1)
        self.assertEqual(self.balances(), (balances[0] - 3, balances[1] + 3, balances[2] + 450, balances[3] - 450))

    def signed_http_order(self, party, kind):
        account = self.party_accounts[party.address]
        wallet = self.party_wallets[party.address]
        body = {
            "submission_id": str(uuid4()),
            "owner_account_uuid": str(account.pk),
            "token": str(self.token.pk),
            "wallet_uuid": str(wallet.pk),
            "wallet_address": wallet.address,
            "order_type": kind,
            "quantity": 10,
            "min_quantity": 0,
            "price_per_share": "1.50",
        }
        self.client.force_authenticate(account.user_profile.user)
        message = self.client.post("/api/v1/trading/orders/create/message/", body, format="json")
        self.assertEqual(message.status_code, 200, message.content)
        challenge = message.json()["challenge"]
        signature = party.sign_message(
            signable_message(challenge["domain"], challenge["types"], challenge["message"])
        ).signature.to_0x_hex()
        created = self.client.post(
            "/api/v1/trading/orders/create/",
            {**body, "digest": challenge["digest"], "signature": signature},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        return created.json()

    def test_two_accounts_signed_http_orders_settle_to_completed_under_a_local_depth_policy(self):
        Asset.objects.filter(pk=self.tenant.refs.stablecoin.pk).update(decimals=6)
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        Operator.get().supported_settlement_assets.set([self.tenant.refs.stablecoin])
        self.assertNotEqual(self.tenant.account.pk, self.buyer_tenant.account.pk)
        resting = self.signed_http_order(self.seller, "sell")
        self.assertIsNone(resting["match"])
        created = self.signed_http_order(self.buyer, "buy")
        self.assertEqual(created["match"]["counterOrder"], resting["order"]["uuid"])
        swap = SwapOrder.objects.get(pk=created["match"]["swapOrder"])
        self.assertEqual((swap.share_amount, swap.payment_amount), (10, 1500))
        orders = (
            TransferOrder.objects.get(pk=resting["order"]["uuid"]),
            TransferOrder.objects.get(pk=created["order"]["uuid"]),
        )
        for party, order in zip((self.seller, self.buyer), orders):
            raw = self.signed_approval(swap, order, party)
            response = self.broadcast_approval(swap, order, raw)
            self.assertEqual(response.status_code, 200, response.content)
            recorded = SwapApprovalSubmission.objects.get(tx_hash=response.json()["txHash"])
            self.assertEqual(recorded.outcome, "confirmed")
            url, identity = self.approval_route(swap, order)
            message = self.client.get(url + "/", identity)
            self.assertEqual(message.status_code, 200, message.content)
            signable = encode_typed_data(full_message=message.json()["typedData"])
            signed = self.client.post(
                url + "/sign/",
                identity
                | {
                    "signature": party.sign_message(signable).signature.to_0x_hex(),
                    "signer_address": party.address,
                },
                format="json",
            )
            self.assertEqual(signed.status_code, 200, signed.content)
        swap.refresh_from_db()
        self.assertEqual(swap.status, "executing")
        before = self.balances()
        self.assertEqual(swap_execution.recover(swap.transaction_id), "confirmed")
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES={"evm:31337": {"mode": "depth", "depth": 2}}):
            self.assertIsNone(swap_execution.settle(swap.transaction_id))
            swap.refresh_from_db()
            self.assertEqual(swap.status, "executing")
            self.assertIsNone(swap.completed_at)
            self.w3.provider.make_request("evm_mine", [])
            self.assertEqual(swap_execution.settle(swap.transaction_id), "completed")
            self.assertIsNone(swap_execution.settle(swap.transaction_id))
        swap.refresh_from_db()
        self.assertEqual(swap.status, "completed")
        self.assertIsNotNone(swap.completed_at)
        parents = TransferOrder.objects.filter(pk__in=[swap.sell_order_id, swap.buy_order_id]).order_by("pk")
        self.assertEqual([(order.status, order.filled_quantity) for order in parents], [("completed", 10)] * 2)
        self.assertEqual(self.balances(), (before[0] - 10, before[1] + 10, before[2] + 1500, before[3] - 1500))

    def test_worker_killed_after_real_approval_acceptance_replays_nothing_and_records_the_receipt(self):
        swap, orders = self.matched_swap()
        raw = self.signed_approval(swap, orders[0], self.seller)
        nonce = self.w3.eth.get_transaction_count(self.seller.address)
        configured = {
            name: getattr(settings, name) for name in (*CHAIN_ENV[1:], "BLOCKCHAIN_CHAIN_ID", "BLOCKCHAIN_RPC_URL")
        }
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tokens.tests.swap_approval_submission_chain_worker",
                str(swap.pk),
                str(self.tenant.user.pk),
                Web3.to_hex(raw),
            ],
            env={
                **os.environ,
                "SWAP_CHAIN_TEST_DATABASE": json.dumps(connections[current_alias()].settings_dict, default=str),
                "SWAP_CHAIN_TEST_SETTINGS": json.dumps(configured),
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        row = SwapApprovalSubmission.objects.get(tx_hash=Web3.to_hex(Web3.keccak(raw)))
        self.assertEqual(
            (row.outcome, row.acknowledged_at, bytes(row.raw_transaction), row.nonce), ("pending", None, raw, nonce)
        )
        self.assertEqual(self.w3.eth.get_transaction_count(self.seller.address), nonce + 1)
        with patch.object(
            BaseChainClient, "send_raw_transaction", side_effect=AssertionError("No resend after original acceptance")
        ):
            self.assertEqual(recover_swap_approval_submissions(0), {"attempted": 1, "outcomes": {"confirmed": 1}})
            replay = self.broadcast_approval(swap, orders[0], raw)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()["txHash"], row.tx_hash)
        row.refresh_from_db()
        receipt = self.w3.eth.get_transaction_receipt(row.tx_hash)
        self.assertEqual(
            (row.outcome, row.block_number, row.block_hash, row.gas_used),
            ("confirmed", receipt["blockNumber"], Web3.to_hex(receipt["blockHash"]), receipt["gasUsed"]),
        )
        observed = self.w3.eth.get_transaction(row.tx_hash)
        self.assertEqual(
            (observed["nonce"], bytes(observed["input"])),
            (row.nonce, approval_submissions.approve_calldata(settings.ATOMIC_SWAP_ADDRESS)),
        )
        self.assertEqual(
            self._contract().functions.allowance(self.seller.address, settings.ATOMIC_SWAP_ADDRESS).call(),
            MAX_UINT256,
        )
        self.assertEqual(SwapApprovalSubmission.objects.count(), 1)

    def test_worker_death_after_real_swap_acceptance_recovers_without_another_nonce(self):
        swap = self.admit_swap()
        before = self.balances()
        nonce = self._signer_nonce()
        configured = {
            name: getattr(settings, name) for name in (*CHAIN_ENV[1:], "BLOCKCHAIN_CHAIN_ID", "BLOCKCHAIN_RPC_URL")
        }
        process = subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.swap_execution_chain_worker", str(swap.transaction_id)],
            env={
                **os.environ,
                "SWAP_CHAIN_TEST_DATABASE": json.dumps(connections[current_alias()].settings_dict, default=str),
                "SWAP_CHAIN_TEST_SETTINGS": json.dumps(configured),
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        swap.refresh_from_db()
        original = swap.transaction.outgoing_operation.current_attempt
        self.assertEqual(original.nonce, nonce)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(swap.status, "executing")
        self.assertEqual(swap.transaction.status, "submitted")
        self.assertEqual(self.balances(), (before[0] - 3, before[1] + 3, before[2] + 450, before[3] - 450))
        with patch.object(BaseChainClient, "send_raw_transaction", side_effect=AssertionError("Already included")):
            self.assertEqual(swap_execution.recover(swap.transaction_id), "confirmed")
        swap.refresh_from_db()
        self.assertEqual(swap.transaction.outgoing_operation.current_attempt_id, original.pk)
        self.assertEqual(swap.status, "executing")
        self.assertEqual(self._signer_nonce(), nonce + 1)

    def test_unsent_swap_reuses_bytes_while_another_common_writer_reserves_the_next_nonce(self):
        from blockchain.services import outgoing

        swap = self.admit_swap()
        nonce = self._signer_nonce()
        with patch.object(BaseChainClient, "send_raw_transaction", side_effect=ConnectionError("Synthetic outage")):
            self.assertEqual(swap_execution.recover(swap.transaction_id), "signed")
        swap.refresh_from_db()
        original = swap.transaction.outgoing_operation.current_attempt
        self.assertEqual(self._signer_nonce(), nonce)
        other = outgoing.open_operation(
            "synthetic-common-writer",
            chain_id=31337,
            sender=original.operation.intent["sender"],
            to=self.seller.address,
            data="0x",
        )
        sibling = outgoing.sign_operation(
            other, outgoing.prepare_operation(other, self.chain), settings.BLOCKCHAIN_OPERATOR_KEY
        )
        self.assertEqual((original.nonce, sibling.nonce), (nonce, nonce + 1))
        original_send = self.chain.send_raw_transaction
        with patch.object(self.chain, "send_raw_transaction", wraps=original_send) as send:
            self.assertEqual(swap_execution.recover(swap.transaction_id, client=self.chain), "confirmed")
        send.assert_called_once_with(bytes(original.raw_transaction))
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(outgoing.broadcast_operation(other, self.chain).tx_hash, sibling.tx_hash)
        self.assertEqual(self._signer_nonce(), nonce + 2)


@chain_available
@override_settings(**CHAIN_SETTINGS)
class ShareTokenChainTest(ChainTestMixin, APITransactionTestCase):
    @override_settings(WALLET_CHAIN_FINALITY_POLICIES={"evm:31337": {"mode": "depth", "depth": 2}})
    def test_register_snapshot_pins_real_contract_reads_and_excludes_a_later_unfinalized_mint(self):
        self._deployed()
        first = self._whitelisted_request(10)
        self.assertEqual(self._execute(first)["status"], "executing")
        self.w3.provider.make_request("evm_mine", [])
        self.assertTrue(self._execute(first)["success"])
        initial = register_snapshot.capture_snapshot(self.token.pk)
        self.assertEqual(initial["issued_supply"], "10")
        second = self._issuance_request(5)
        self.assertEqual(self._execute(second)["status"], "executing")
        pending = register_snapshot.capture_snapshot(self.token.pk)
        self.assertEqual(pending["issued_supply"], "10")
        self.assertEqual(self._contract().functions.totalSupply().call(), 15)
        self.w3.provider.make_request("evm_mine", [])
        completed = register_snapshot.capture_snapshot(self.token.pk)
        self.assertTrue(self._execute(second)["success"])
        self.assertEqual(completed["issued_supply"], "15")
        self.assertEqual(completed["holdings"], [{"address": self.investor, "shares": "15"}])
        self.assertNotIn("transfers", completed)
        self.assertGreater(completed["block"]["number"], initial["block"]["number"])

    @override_settings(WALLET_CHAIN_FINALITY_POLICIES={"evm:31337": {"mode": "depth", "depth": 2}})
    def test_real_issuance_waits_for_finality_then_completes_without_another_mint(self):
        self._deployed()
        request = self._whitelisted_request(10)
        nonce = self._signer_nonce()
        result = self._execute(request)
        self.assertEqual((result["success"], result["status"]), (False, "executing"))
        command = ShareIssuanceExecution.objects.get(request_id=request.pk)
        issuance = ShareIssuance.objects.get(pk=command.issuance_id)
        self.assertEqual(issuance.status, "processing")
        self.assertIsNone(issuance.completed_at)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 0})
        self.w3.provider.make_request("evm_mine", [])
        self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 1})
        completed = self._execute(request)
        self.assertTrue(completed["success"])
        self.assertEqual(completed["tx_hash"], result["tx_hash"])
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(SignedAttempt.objects.filter(operation_id=command.operation_id).count(), 1)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)

    @override_settings(WALLET_CHAIN_FINALITY_POLICIES={"evm:31337": {"mode": "depth", "depth": 2}})
    def test_real_issuance_reorg_reinclusion_keeps_original_bytes_and_records_final_block(self):
        self._deployed()
        request = self._whitelisted_request(10)
        before = self.w3.provider.make_request("evm_snapshot", [])["result"]
        pending = self._execute(request)
        self.assertEqual(pending["status"], "executing")
        command = ShareIssuanceExecution.objects.get(request_id=request.pk)
        operation = OutgoingOperation.objects.get(pk=command.operation_id)
        attempt = operation.current_attempt
        original_block = (operation.block_number, operation.block_hash)
        self.assertTrue(self.w3.provider.make_request("evm_revert", [before])["result"])
        self.assertEqual(self._contract().functions.totalSupply().call(), 0)
        self.assertEqual(self._execute(request)["status"], "executing")
        self.w3.provider.make_request("evm_mine", [])
        self.assertEqual(Web3.to_hex(self.w3.eth.send_raw_transaction(bytes(attempt.raw_transaction))), attempt.tx_hash)
        receipt = self.w3.eth.wait_for_transaction_receipt(attempt.tx_hash)
        self.assertNotEqual((receipt["blockNumber"], Web3.to_hex(receipt["blockHash"])), original_block)
        self.w3.provider.make_request("evm_mine", [])
        completed = self._execute(request)
        self.assertTrue(completed["success"])
        self.assertEqual(completed["block_number"], receipt["blockNumber"])
        record = BlockchainTransaction.objects.get(pk=command.transaction_id)
        self.assertEqual(record.block_hash, Web3.to_hex(receipt["blockHash"]))
        operation.refresh_from_db()
        self.assertEqual((operation.block_number, operation.block_hash), original_block)
        self.assertEqual(SignedAttempt.objects.filter(operation_id=operation.pk).count(), 1)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)

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
        self._pause(True)
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
        self.assertEqual(self._execute(not_whitelisted)["status"], "failed")
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        not_whitelisted.refresh_from_db()
        self.assertEqual(not_whitelisted.status, RequestStatus.FAILED)
        self.assertIn(NOT_WHITELISTED, not_whitelisted.execution_notes)
        self.assertNotIn("Refused", not_whitelisted.review_notes)

        change = self._whitelist(self.investor)
        tx_hash, entry = change.transaction.tx_hash, change.entry
        self.assertTrue(tx_hash)
        self.assertTrue(whitelist.is_whitelisted(self.investor))
        self.assertTrue(entry.is_whitelisted)

        too_many = self._issuance_request(amount=CAP + 1)
        blocks_before = self.w3.eth.block_number
        self.assertEqual(self._execute(too_many)["status"], "failed")
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        too_many.refresh_from_db()
        self.assertEqual(too_many.status, RequestStatus.FAILED)
        self.assertIn(EXCEEDS_AUTHORIZED, too_many.execution_notes)
        self.assertNotIn("Refused", too_many.review_notes)
        self.assertFalse(ShareIssuance.objects.filter(token=self.token, status="completed").exists())

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
        self.assertEqual(refusal["status"], "superseded")
        self.assertIsNone(refusal["tx_hash"])
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        stale.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual((stale.status, stale.review_notes), (RequestStatus.SUPERSEDED, ""))
        for cap in (CAP + 10, CAP + 500):
            self.assertIn(str(cap), stale.rejection_reason)
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 500)
        self.assertEqual(self.token.total_supply, str(CAP + 500))

        self._pause(True)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)
        self.assertTrue(self._contract().functions.paused().call())
        while_paused = self._issuance_request(amount=1)
        blocks_before = self.w3.eth.block_number
        self.assertEqual(self._execute(while_paused)["status"], "failed")
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        while_paused.refresh_from_db()
        self.assertEqual(while_paused.status, RequestStatus.FAILED)
        self.assertIn(TOKEN_PAUSED, while_paused.execution_notes)
        self.assertNotIn("Refused", while_paused.review_notes)
        self.assertEqual(ShareIssuance.objects.filter(token=self.token, status="completed").count(), 1)
        self._pause(False)
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

        with self._missing_issuance_receipts():
            self.assertEqual(self._execute(request)["status"], "executing")

        request.refresh_from_db()
        issuance = ShareIssuance.objects.get(token=self.token)
        self.assertEqual(request.status, RequestStatus.EXECUTING)
        self.assertFalse(request.can_be_executed)
        self.assertEqual(
            (issuance.status, issuance.idempotency_key), (IssuanceStatus.PROCESSING, f"issuance-request:{request.uuid}")
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
            self.assertEqual(self._execute(request)["status"], "executing")
        issuance = ShareIssuance.objects.get(token=self.token)
        raw = bytes(SignedAttempt.objects.get(tx_hash=issuance.tx_hash).raw_transaction)
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
            self.assertEqual(self._execute(request)["status"], "executed")
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

    def test_process_killed_after_real_mint_recovers_original_transaction_without_another_nonce(self):
        self._deployed()
        request = self._whitelisted_request(10)
        nonce = self._signer_nonce()
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["ISSUANCE_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})

        def worker(phase):
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "tokens.tests.issuance_chain_worker",
                    phase,
                    str(request.pk),
                    str(self.staff.pk),
                ],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            return finish(process)

        code, out, err = worker("accepted")
        self.assertEqual(code, -signal.SIGKILL, out + err)
        command = ShareIssuanceExecution.objects.get(request_id=request.pk)
        attempt = SignedAttempt.objects.get(operation=command.operation)
        original = (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce)
        request.refresh_from_db()
        self.assertEqual(request.status, "executing")
        self.assertEqual(command.transaction.tx_hash, attempt.tx_hash)
        self.assertEqual(command.transaction.status, "submitted")
        self.assertEqual(self.w3.eth.get_transaction_receipt(attempt.tx_hash)["status"], 1)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)
        code, out, err = worker("recover")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(json.loads(out)["status"], "executed")
        self.assertEqual(json.loads(out)["tx_hash"], attempt.tx_hash)
        attempt.refresh_from_db()
        self.assertEqual((attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce), original)
        self.assertEqual(SignedAttempt.objects.filter(operation=command.operation).count(), 1)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 10)

    def test_real_issuance_revert_survives_interrupted_projection_and_explicit_retry(self):
        self._deployed()
        request = self._whitelisted_request(10)
        nonce = self._signer_nonce()
        with (
            patch.object(BaseChainClient, "estimate_gas", return_value=30000),
            patch.object(issuance_execution, "_project", side_effect=KeyboardInterrupt),
        ):
            with self.assertRaises(KeyboardInterrupt):
                self._execute(request)
        command = ShareIssuanceExecution.objects.get(request_id=request.pk)
        original = SignedAttempt.objects.get(operation=command.operation)
        self.assertEqual(self.w3.eth.get_transaction_receipt(original.tx_hash)["status"], 0)
        self.assertEqual(self._contract().functions.totalSupply().call(), 0)
        self.assertEqual(self._execute(request)["status"], "failed")
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(BlockchainTransaction.objects.get(tx_hash=original.tx_hash).status, "reverted")
        self.assertEqual(self._execute(request)["status"], "executed")
        self.assertEqual(self._signer_nonce(), nonce + 2)
        self.assertEqual(SignedAttempt.objects.filter(operation=command.operation).count(), 2)
        self.assertEqual(BlockchainTransaction.objects.get(tx_hash=original.tx_hash).status, "reverted")
        self.assertEqual(self._contract().functions.totalSupply().call(), 10)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)

    def test_process_killed_after_real_cap_transaction_recovers_without_mint_or_second_nonce(self):
        self._deployed()
        self.assertTrue(self._execute(self._whitelisted_request(10))["success"])
        increase = self._increase(500)
        nonce = self._signer_nonce()
        minted = self._contract().functions.totalSupply().call()
        balance = self._contract().functions.balanceOf(self.investor).call()
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["CAPITAL_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})

        def worker(phase):
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "tokens.tests.capital_chain_worker",
                    phase,
                    str(increase.pk),
                    str(self.staff.pk),
                ],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            return finish(process)

        code, out, err = worker("accepted")
        self.assertEqual(code, -signal.SIGKILL, out + err)
        increase.refresh_from_db()
        self.token.refresh_from_db()
        command = CapitalIncreaseExecution.objects.get(request_id=increase.pk)
        attempt = SignedAttempt.objects.get(operation=command.operation)
        receipt = self.w3.eth.get_transaction_receipt(attempt.tx_hash)
        self.assertEqual(receipt["status"], 1)
        self.assertEqual(receipt["to"].lower(), self.token.contract_address.lower())
        self.assertEqual(increase.status, "executing")
        self.assertEqual(int(self.token.total_supply), CAP)
        self.assertEqual(command.transaction.tx_hash, attempt.tx_hash)
        self.assertEqual(command.transaction.status, "submitted")
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 500)
        code, out, err = worker("recover")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(json.loads(out)["status"], "executed")
        self.assertEqual(json.loads(out)["tx_hash"], attempt.tx_hash)
        command.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual(command.transaction.status, "confirmed")
        self.assertEqual(int(self.token.total_supply), CAP + 500)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        self.assertEqual(SignedAttempt.objects.filter(operation=command.operation).count(), 1)
        self.assertEqual(self._contract().functions.totalSupply().call(), minted)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), balance)
        self.assertEqual(ShareIssuance.objects.filter(token=self.token, status="completed").count(), 1)

    def test_lost_set_authorized_receipt_is_resumed_on_retry_instead_of_refusing_the_increase(self):
        self._deployed()
        increase = self._increase(500)

        with patch.object(BaseChainClient, "get_transaction_receipt", return_value=None):
            self.assertFalse(self._execute(increase)["success"])

        increase.refresh_from_db()
        self.token.refresh_from_db()
        record = BlockchainTransaction.objects.get(
            related_model="tokens.CapitalIncreaseRequest", related_uuid=increase.uuid
        )
        self.assertEqual((increase.status, self.token.total_supply), (RequestStatus.EXECUTING, str(CAP)))
        self.assertFalse(increase.can_be_executed)
        self.assertEqual((record.status, record.function_name), (TransactionStatus.SUBMITTED, "setAuthorizedShares"))
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

    def test_real_pause_observation_and_unpause_preserve_issuance_guards(self):
        self._deployed()
        contract = self._contract()

        self._pause(True)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.PAUSED)
        self.assertTrue(contract.functions.paused().call())

        self._pause(False)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertFalse(contract.functions.paused().call())

        self.chain.send_transaction(contract.functions.pause(), settings.BLOCKCHAIN_OPERATOR_KEY)
        self.assertTrue(contract.functions.paused().call())
        nonce_before = self._signer_nonce()
        self._pause(True)
        self.token.refresh_from_db()
        self.assertEqual((self.token.status, self._signer_nonce()), (ShareTokenStatus.PAUSED, nonce_before))

        ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.DEPLOYED)
        self.token.refresh_from_db()
        request = self._whitelisted_request(amount=5)
        blocks_before = self.w3.eth.block_number
        self.assertEqual(self._execute(request)["status"], "failed")
        request.refresh_from_db()
        self.assertIn(TOKEN_PAUSED, request.execution_notes)
        self.assertEqual(self.w3.eth.block_number, blocks_before)
        self._pause(False)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, ShareTokenStatus.DEPLOYED)
        self.assertFalse(contract.functions.paused().call())

        self.assertTrue(self._execute(request)["success"])
        self.assertEqual(contract.functions.balanceOf(self.investor).call(), 5)

    def test_worker_killed_after_the_mint_is_finished_by_the_executing_sweep(self):
        self._deployed()
        request = self._whitelisted_request(amount=10)

        with patch.object(issuance_execution, "_project", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self._execute(request)

        request.refresh_from_db()
        issuance = ShareIssuance.objects.get(token=self.token)
        self.assertEqual((request.status, issuance.status), (RequestStatus.EXECUTING, IssuanceStatus.PROCESSING))
        self.assertFalse(request.can_be_executed)
        self.assertTrue(issuance.tx_hash.startswith("0x"), issuance.tx_hash)
        self.assertEqual(self._contract().functions.balanceOf(self.investor).call(), 10)
        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 0)

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
        self.assertTrue(all(isinstance(value, dict) for value in results.values()), results)
        self.assertTrue(any(value.get("success") for value in results.values()), results)
        self.assertTrue(self._execute(increase)["success"])
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
        self.assertEqual(result["status"], "superseded")
        self.assertIsNone(result["tx_hash"])
        small.refresh_from_db()
        self.token.refresh_from_db()
        self.assertEqual(small.status, RequestStatus.SUPERSEDED)
        self.assertIn("do not raise the recorded cap", small.rejection_reason)
        self.assertEqual(small.review_notes, "")
        self.assertEqual(self._contract().functions.authorizedShares().call(), CAP + 1000)
        self.assertEqual(self.token.total_supply, str(CAP + 1000))

    def test_resuming_a_failed_increase_while_another_is_in_flight_is_refused_with_a_reason(self):
        self._deployed()
        stalled = self._increase(1000)
        with patch.object(BaseChainClient, "estimate_gas", side_effect=RuntimeError("Synthetic preparation failure")):
            self.assertEqual(self._execute(stalled)["status"], "failed")
        self._increase(50)
        nonce_before = self._signer_nonce()

        result = self._execute(stalled)

        stalled.refresh_from_db()
        self.assertFalse(result["success"], result)
        self.assertIn("has another capital increase in flight", result["error"])
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

    def test_real_mined_revert_survives_interrupted_projection_and_explicit_retry(self):
        from dataclasses import replace

        from blockchain.models import OutgoingOperation, SignedAttempt
        from blockchain.services import outgoing
        from tokens.services import mint_service

        before_balance = self.contract.functions.balanceOf(self.recipient).call()
        before_nonce = self.w3.eth.get_transaction_count(self.signer, "pending")
        prepare = outgoing.prepare_operation
        project = mint_service._project

        def insufficient_gas(claim, client):
            prepared = prepare(claim, client)
            self.assertGreater(prepared.gas, 30000)
            return replace(prepared, gas=30000)

        def interrupted_projection(request_id, claim):
            if OutgoingOperation.objects.get(pk=claim.operation_id).status == "reverted":
                raise SystemExit("Stopped after real mined revert")
            return project(request_id, claim)

        with patch.object(outgoing, "prepare_operation", insufficient_gas):
            with patch.object(mint_service, "_project", interrupted_projection), self.assertRaises(SystemExit):
                mint_service.execute(self.request, self.actor)
        self.request.refresh_from_db()
        previous, operation = self.request.transaction, self.request.operation
        observed = self.w3.eth.get_transaction_receipt(previous.tx_hash)
        self.assertEqual(observed["status"], 0)
        self.assertEqual(observed["gasUsed"], 30000)
        self.assertEqual(operation.status, "reverted")
        self.assertEqual(self.contract.functions.balanceOf(self.recipient).call(), before_balance)
        mint_service.execute(self.request, self.actor, retry_of=operation.claim_id)
        self.assertEqual(self.request.status, "executed")
        self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(self.contract.functions.balanceOf(self.recipient).call(), before_balance + self.request.amount)
        self.assertEqual(self.w3.eth.get_transaction_count(self.signer, "pending"), before_nonce + 2)
        previous.refresh_from_db()
        self.assertEqual(previous.status, "reverted")
        self.assertEqual(previous.block_number, observed["blockNumber"])
        self.assertEqual(previous.block_hash, Web3.to_hex(observed["blockHash"]))
        self.assertEqual(previous.gas_used, observed["gasUsed"])


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


@chain_available
@override_settings(**CHAIN_SETTINGS)
class SwapApprovalChainTest(ChainTestMixin, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.staff.user_permissions.add(Permission.objects.get(codename="change_sharetoken"))
        self._deployed()

    def approval(self):
        return TokenDeployment.objects.get(pk=self.token.deployment_id)

    def test_worker_killed_after_real_approval_acceptance_recovers_original_receipt(self):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["APPROVAL_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        env["APPROVAL_TEST_CHAIN"] = json.dumps(CHAIN_SETTINGS)
        nonce = self._signer_nonce()
        process = subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.swap_approval_chain_worker", str(self.token.deployment_id)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        command = self.approval()
        attempt = command.approval_operation.current_attempt
        self.assertEqual(
            (command.approval_outcome, command.approval_transaction.tx_hash, attempt.nonce),
            ("executing", attempt.tx_hash, nonce),
        )
        with patch.object(
            BaseChainClient, "send_raw_transaction", side_effect=AssertionError("No resend after original receipt")
        ):
            self.assertEqual(swap_approval.recover(command.pk), "confirmed")
        self.assertEqual(self._signer_nonce(), nonce + 1)
        observed = self.w3.eth.get_transaction(attempt.tx_hash)
        self.assertEqual(
            (observed["nonce"], bytes(observed["input"])),
            (attempt.nonce, bytes.fromhex(command.approval_intent["data"][2:])),
        )
        contract = self.chain.load_contract("AtomicSwap", settings.ATOMIC_SWAP_ADDRESS)
        self.assertTrue(contract.functions.approvedShareTokens(self.token.contract_address).call())

    def test_real_revert_retains_receipt_before_explicit_retry(self):
        target = settings.ATOMIC_SWAP_ADDRESS
        original_code = Web3.to_hex(self.w3.eth.get_code(target))
        send = self.chain.send_raw_transaction

        def reject_signed_call(raw):
            self.w3.provider.make_request("hardhat_setCode", [target, "0x60006000fd"])
            return send(raw)

        with patch.object(self.chain, "send_raw_transaction", side_effect=reject_signed_call):
            self.assertEqual(swap_approval.recover(self.token.deployment_id), "failed")
        command = self.approval()
        previous = command.approval_transaction
        mined = self.w3.eth.get_transaction_receipt(previous.tx_hash)
        self.assertEqual(
            (previous.status, previous.block_hash, previous.block_number),
            ("reverted", Web3.to_hex(mined["blockHash"]), mined["blockNumber"]),
        )
        self.w3.provider.make_request("hardhat_setCode", [target, original_code])
        swap_approval.retry(self.token, self.staff, swap_approval.retry_confirmation(self.token, self.staff))
        self.assertEqual(swap_approval.recover(command.pk), "confirmed")
        current = self.approval()
        self.assertNotEqual(current.approval_transaction_id, previous.pk)
        self.assertEqual(current.approval_operation.current_attempt.nonce, previous.nonce + 1)
        previous.refresh_from_db()
        self.assertEqual(previous.status, "reverted")

    def test_approval_and_capital_increase_share_distinct_common_signer_nonces(self):
        from blockchain.services import outgoing

        request = self._increase(100)
        with patch("tokens.tasks.execute_review_request_task.defer"):
            command = capital_execution.admit(
                request, self.staff, confirmed=capital_execution.confirmation(request, self.staff)
            )
        barrier = threading.Barrier(2)
        prepare = outgoing.prepare_operation

        def prepared_together(*args, **kwargs):
            result = prepare(*args, **kwargs)
            barrier.wait(timeout=20)
            return result

        results = {}

        def run(label, action):
            try:
                results[label] = action()
            except Exception as exc:
                results[label] = exc
            finally:
                connections.close_all()

        before = self._signer_nonce()
        workers = [
            threading.Thread(target=run, args=("approval", lambda: swap_approval.recover(self.token.deployment_id))),
            threading.Thread(target=run, args=("capital", lambda: capital_execution.recover(command.pk))),
        ]
        with patch.object(outgoing, "prepare_operation", side_effect=prepared_together):
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(timeout=40)
        self.assertFalse(any(worker.is_alive() for worker in workers), results)
        self.assertFalse(any(isinstance(value, Exception) for value in results.values()), results)
        self.assertEqual(swap_approval.recover(self.token.deployment_id), "confirmed")
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executed")
        command.refresh_from_db()
        attempts = (self.approval().approval_operation.current_attempt, command.operation.current_attempt)
        self.assertEqual({attempt.nonce for attempt in attempts}, {before, before + 1})
        self.assertEqual(self._signer_nonce(), before + 2)

    def test_existing_real_approval_is_observed_without_a_local_approval_attempt(self):
        contract = self.chain.load_contract("AtomicSwap", settings.ATOMIC_SWAP_ADDRESS)
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        tx_hash = contract.functions.setShareTokenApproval(self.token.contract_address, True).transact({"from": sender})
        self.w3.eth.wait_for_transaction_receipt(tx_hash)
        nonce = self._signer_nonce()
        self.assertEqual(swap_approval.recover(self.token.deployment_id), "observed_approved")
        command = self.approval()
        block = self.w3.eth.get_block(command.approval_observation["block_number"])
        self.assertEqual(Web3.to_hex(block["hash"]), command.approval_observation["block_hash"])
        self.assertIsNone(command.approval_operation_id)
        self.assertIsNone(command.approval_transaction_id)
        self.assertEqual(self._signer_nonce(), nonce)


@chain_available
@override_settings(**CHAIN_SETTINGS)
class PauseChangeChainTest(ChainTestMixin, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self._deployed()
        self.change = pause_changes.submit(self.token, self.tenant.user, uuid4(), True)

    def test_worker_killed_after_real_pause_acceptance_recovers_the_original_receipt(self):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["PAUSE_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        env["PAUSE_TEST_CHAIN"] = json.dumps(CHAIN_SETTINGS)
        nonce = self._signer_nonce()
        process = subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.pause_chain_worker", str(self.change.pk)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        self.change.refresh_from_db()
        attempt = self.change.operation.current_attempt
        self.assertEqual((self.change.status, attempt.nonce), ("executing", nonce))
        with patch.object(
            BaseChainClient, "send_raw_transaction", side_effect=AssertionError("Original receipt needs no resend")
        ):
            self.assertEqual(pause_recovery.recover(self.change.pk).status, "confirmed")
        self.assertTrue(self._contract().functions.paused().call())
        self.assertEqual(self._signer_nonce(), nonce + 1)
        observed = self.w3.eth.get_transaction(attempt.tx_hash)
        self.assertEqual(
            (observed["nonce"], bytes(observed["input"])),
            (attempt.nonce, bytes.fromhex(self.change.intent["data"][2:])),
        )
        self._pause(False)
        pause_recovery.recover(self.change.pk)
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")
        self.assertFalse(self._contract().functions.paused().call())

    def test_real_revert_retains_original_receipt_and_requires_a_new_submission(self):
        target = self.token.contract_address
        original_code = Web3.to_hex(self.w3.eth.get_code(target))
        send = self.chain.send_raw_transaction

        def reject_signed_call(raw):
            self.w3.provider.make_request("hardhat_setCode", [target, "0x60006000fd"])
            return send(raw)

        with patch.object(self.chain, "send_raw_transaction", side_effect=reject_signed_call):
            self.assertEqual(pause_recovery.recover(self.change.pk).status, "failed")
        self.change.refresh_from_db()
        previous = self.change.operation.current_attempt
        mined = self.w3.eth.get_transaction_receipt(previous.tx_hash)
        self.assertEqual(
            (self.change.operation.status, self.change.operation.block_hash),
            ("reverted", Web3.to_hex(mined["blockHash"])),
        )
        self.w3.provider.make_request("hardhat_setCode", [target, original_code])
        current = self._pause(True)
        self.assertNotEqual(current.pk, self.change.pk)
        self.assertEqual(current.operation.current_attempt.nonce, previous.nonce + 1)
        self.assertEqual(pause_recovery.recover(self.change.pk).status, "failed")

    def test_real_initial_observation_preserves_block_identity_without_signing(self):
        self.chain.send_transaction(self._contract().functions.pause(), settings.BLOCKCHAIN_OPERATOR_KEY)
        before = self._signer_nonce()
        result = pause_recovery.recover(self.change.pk)
        self.assertEqual(result.status, "observed")
        self.assertIsNone(result.operation_id)
        block = self.w3.eth.get_block(result.observation["block_number"])
        self.assertEqual(Web3.to_hex(block["hash"]), result.observation["block_hash"])
        self.assertEqual(self._signer_nonce(), before)

    def test_pause_and_approval_share_distinct_common_signer_nonces(self):
        from blockchain.services import outgoing

        barrier = threading.Barrier(2)
        prepare = outgoing.prepare_operation

        def prepared_together(*args, **kwargs):
            result = prepare(*args, **kwargs)
            barrier.wait(timeout=20)
            return result

        results = {}

        def run(label, action):
            try:
                results[label] = action()
            except Exception as exc:
                results[label] = exc
            finally:
                connections.close_all()

        before = self._signer_nonce()
        workers = [
            threading.Thread(target=run, args=("approval", lambda: swap_approval.recover(self.token.deployment_id))),
            threading.Thread(target=run, args=("pause", lambda: pause_recovery.recover(self.change.pk))),
        ]
        with patch.object(outgoing, "prepare_operation", side_effect=prepared_together):
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(timeout=40)
        self.assertFalse(any(worker.is_alive() for worker in workers), results)
        self.assertFalse(any(isinstance(value, Exception) for value in results.values()), results)
        self.assertEqual(swap_approval.recover(self.token.deployment_id), "confirmed")
        self.assertEqual(pause_recovery.recover(self.change.pk).status, "confirmed")
        self.change.refresh_from_db()
        approval = TokenDeployment.objects.get(pk=self.token.deployment_id)
        attempts = (approval.approval_operation.current_attempt, self.change.operation.current_attempt)
        self.assertEqual({attempt.nonce for attempt in attempts}, {before, before + 1})
        self.assertEqual(self._signer_nonce(), before + 2)


@chain_available
@override_settings(**CHAIN_SETTINGS)
class NAVUpdateChainTest(APITransactionTestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model

        from blockchain.tests.outgoing_fixtures import admitted_signer

        get_base_chain_client.cache_clear()
        BaseChainClient._instance = None
        BaseChainClient._web3 = None
        self.chain = get_base_chain_client()
        self.w3 = self.chain.w3
        snapshot = self.w3.provider.make_request("evm_snapshot", [])["result"]
        self.addCleanup(self.w3.provider.make_request, "evm_revert", [snapshot])
        self.actor = get_user_model().objects.create_superuser(email="chain-nav@example.test", password="synthetic")
        self.signer = Account.from_key(CHAIN_SETTINGS["BLOCKCHAIN_OPERATOR_KEY"]).address
        artifact = json.loads(
            (Path(settings.BASE_DIR).parent / "contracts/artifacts/contracts/AUSG.sol/AUSG.json").read_text()
        )
        constructor = self.w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"]).constructor(
            CHAIN_SETTINGS["WHITELIST_CONTRACT_ADDRESS"], self.signer
        )
        _, deployment_receipt = self.chain.send_transaction(constructor, CHAIN_SETTINGS["BLOCKCHAIN_OPERATOR_KEY"])
        address = deployment_receipt["contractAddress"]
        self.contract = self.chain.load_contract("AUSG", address)
        self.chain.send_transaction(
            self.contract.functions.addNavUpdater(self.signer), CHAIN_SETTINGS["BLOCKCHAIN_OPERATOR_KEY"]
        )
        admitted_signer(sender=self.signer)
        self.token = YieldToken.objects.create(
            name="Synthetic chain NAV",
            symbol="AUSG",
            contract_address=address,
            decimals=6,
            nav_per_token="1.02",
            total_reserve_value="100",
        )
        self.asset, _ = Asset.objects.update_or_create(
            symbol="AUSG", defaults={"name": "Synthetic NAV", "asset_type": "erc20_token"}
        )
        self.update = self.submit()

    def submit(self, value="1.25", *, chain=True):
        self.token.refresh_from_db()
        return nav.submit(self.token, self.actor, uuid4(), value, "500", update_on_chain=chain)

    def nonce(self):
        return self.w3.eth.get_transaction_count(self.signer, "pending")

    def test_worker_killed_after_real_nav_acceptance_recovers_original_hash_event_and_projection(self):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["NAV_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        env["NAV_TEST_CHAIN"] = json.dumps(CHAIN_SETTINGS)
        nonce = self.nonce()
        process = subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.nav_chain_worker", str(self.update.pk)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        code, out, err = finish(process)
        self.assertEqual(code, -signal.SIGKILL, out + err)
        self.update.refresh_from_db()
        attempt = self.update.operation.current_attempt
        self.assertEqual((self.update.status, attempt.nonce), ("executing", nonce))
        self.assertEqual(self.contract.functions.navPerToken().call(), 1250000)
        with patch.object(
            BaseChainClient, "send_raw_transaction", side_effect=AssertionError("Original receipt needs no resend")
        ):
            result = nav_recovery.recover(self.update.pk)
        self.assertEqual(
            (result.status, result.event["oldNav"], result.event["newNav"]), ("confirmed", "1000000", "1250000")
        )
        self.assertEqual(result.old_nav_per_token, Decimal("1.02"))
        self.assertEqual(self.nonce(), nonce + 1)
        self.token.refresh_from_db()
        self.asset.refresh_from_db()
        self.assertEqual((self.token.nav_per_token, self.asset.current_price), (Decimal("1.25"), Decimal("1.25")))
        observed = self.w3.eth.get_transaction(attempt.tx_hash)
        self.assertEqual(
            (observed["nonce"], bytes(observed["input"])),
            (attempt.nonce, bytes.fromhex(self.update.intent["data"][2:])),
        )
        self.assertEqual(self.asset.snapshots.count(), 1)

    def test_real_pending_transaction_blocks_local_and_chain_until_original_receipt_is_mined(self):
        nonce = self.nonce()
        self.w3.provider.make_request("evm_setAutomine", [False])
        self.addCleanup(self.w3.provider.make_request, "evm_setAutomine", [True])
        self.assertIsNone(nav_recovery.recover(self.update.pk).completed_at)
        original = SignedAttempt.objects.get()
        for chain in (True, False):
            self.assertEqual(self.submit("2", chain=chain).status, "failed")
        self.assertIsNone(nav_recovery.recover(self.update.pk).completed_at)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.w3.provider.make_request("evm_mine", [])
        self.assertIsNotNone(nav_recovery.recover(self.update.pk).completed_at)
        self.update.refresh_from_db()
        self.assertEqual(self.update.operation.current_attempt_id, original.pk)
        self.assertEqual(self.nonce(), nonce + 1)
        self.submit("2", chain=False)
        nav_recovery.recover(self.update.pk)
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("2"))
        self.assertEqual(self.contract.functions.navPerToken().call(), 1250000)

    def test_equal_value_update_still_has_a_distinct_original_event_and_new_timestamp(self):
        nav_recovery.recover(self.update.pk)
        timestamp = self.contract.functions.lastNavUpdate().call()
        next_update = self.submit()
        nonce = self.nonce()
        result = nav_recovery.recover(next_update.pk)
        self.assertEqual((result.event["oldNav"], result.event["newNav"]), ("1250000", "1250000"))
        self.assertGreater(self.contract.functions.lastNavUpdate().call(), timestamp)
        self.assertEqual(self.nonce(), nonce + 1)
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_real_revert_retains_original_receipt_and_new_attempt_requires_new_uuid(self):
        target = self.token.contract_address
        original_code = Web3.to_hex(self.w3.eth.get_code(target))
        send = self.chain.send_raw_transaction

        def revert_signed_call(raw):
            self.w3.provider.make_request("hardhat_setCode", [target, "0x60006000fd"])
            return send(raw)

        with patch.object(self.chain, "send_raw_transaction", side_effect=revert_signed_call):
            self.assertEqual(nav_recovery.recover(self.update.pk).status, "failed")
        self.update.refresh_from_db()
        original = self.update.operation.current_attempt
        self.assertEqual(self.w3.eth.get_transaction_receipt(original.tx_hash)["status"], 0)
        self.w3.provider.make_request("hardhat_setCode", [target, original_code])
        second = self.submit("2")
        self.assertEqual(nav_recovery.recover(second.pk).status, "confirmed")
        self.assertEqual(nav_recovery.recover(self.update.pk).status, "failed")
        self.assertEqual(self.contract.functions.navPerToken().call(), 2000000)
        second.refresh_from_db()
        self.assertEqual(second.operation.current_attempt.nonce, original.nonce + 1)

    def test_real_contract_units_refuse_misconfigured_nav_before_any_new_nonce(self):
        nav_recovery.recover(self.update.pk)
        YieldToken.objects.filter(pk=self.token.pk).update(decimals=2)
        second = self.submit()
        nonce = self.nonce()
        self.assertEqual(nav_recovery.recover(second.pk).status, "failed")
        self.assertEqual(self.nonce(), nonce)
        self.assertEqual(self.contract.functions.navPerToken().call(), 1250000)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_real_confirmed_outcome_projects_after_crash_without_provider_or_rebroadcast(self):
        with patch.object(nav, "project", side_effect=SystemExit), self.assertRaises(SystemExit):
            nav_recovery.recover(self.update.pk)
        self.update.refresh_from_db()
        self.assertEqual((self.update.status, self.update.completed_at), ("confirmed", None))
        self.assertEqual(self.submit(chain=False).status, "failed")
        with patch.object(nav_recovery, "get_base_chain_client", side_effect=AssertionError("Recorded original event")):
            self.assertIsNotNone(nav_recovery.recover(self.update.pk).completed_at)
        self.assertEqual(self.asset.snapshots.count(), 1)

    def test_nav_and_mint_use_distinct_common_signer_nonces(self):
        from blockchain.services import outgoing
        from tokens.services import mint_service
        from tokens.tests.mint_request_fixtures import mint_request

        request = mint_request(self.actor)
        AssetChainDeployment.objects.filter(asset=request.settlement_asset).update(
            contract_address=CHAIN_SETTINGS["STABLECOIN_CONTRACT_ADDRESS"]
        )
        self.w3.provider.make_request("evm_setAutomine", [False])
        self.addCleanup(self.w3.provider.make_request, "evm_setAutomine", [True])
        barrier = threading.Barrier(2)
        original = outgoing.prepare_operation
        results = {}

        def prepared(*args, **kwargs):
            result = original(*args, **kwargs)
            barrier.wait(timeout=20)
            return result

        def run(label, action):
            try:
                results[label] = action()
            except Exception as exc:
                results[label] = exc
            finally:
                connections.close_all()

        nonce = self.nonce()
        workers = [
            threading.Thread(target=run, args=("nav", lambda: nav_recovery.recover(self.update.pk))),
            threading.Thread(target=run, args=("mint", lambda: mint_service.execute(request, self.actor))),
        ]
        with patch.object(outgoing, "prepare_operation", side_effect=prepared):
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(timeout=40)
        self.assertFalse(any(worker.is_alive() for worker in workers), results)
        self.assertFalse(any(isinstance(result, Exception) for result in results.values()), results)
        self.assertEqual(results["nav"].status, "executing")
        self.update.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual((self.update.status, request.status), ("executing", "executing"))
        operations = (self.update.operation_id, request.operation_id)
        fields = ("pk", "operation_id", "claim_id", "signer_id", "nonce", "tx_hash", "raw_transaction")
        attempts = list(SignedAttempt.objects.order_by("pk").values(*fields))
        self.assertEqual(len(attempts), 2)
        self.assertEqual({attempt["nonce"] for attempt in attempts}, {nonce, nonce + 1})
        self.w3.provider.make_request("evm_mine", [])
        with (
            patch.object(
                outgoing, "sign_operation", side_effect=AssertionError("Recover the original signature")
            ) as sign,
            patch.object(
                self.chain, "send_raw_transaction", side_effect=AssertionError("Recover the original receipt")
            ) as send,
        ):
            self.assertEqual(nav_recovery.recover(self.update.pk).status, "confirmed")
            self.assertEqual(mint_service.recover(request.pk), "executed")
        sign.assert_not_called()
        send.assert_not_called()
        self.update.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual((self.update.operation_id, request.operation_id), operations)
        self.assertEqual(list(SignedAttempt.objects.order_by("pk").values(*fields)), attempts)
        self.assertEqual(SigningAccount.objects.get(address=self.signer.lower()).next_nonce, nonce + 2)
        self.assertEqual(self.nonce(), nonce + 2)
