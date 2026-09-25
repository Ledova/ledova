import json
import socket
from contextlib import suppress
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from django.conf import settings
from django.contrib.auth.models import Permission
from django.test import override_settings
from django.urls import reverse
from eth_abi import encode
from eth_account import Account
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.test import APITransactionTestCase
from web3 import Web3
from web3.exceptions import ContractLogicError, Web3RPCError

from companies.models import Company
from feature_flags.models import FeatureFlag
from operators.models import Operator
from shared.db import use_operator
from shared.tests.tenants import make_eligible, make_tenant
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from tokens.models import (
    MintRequestStatus,
    OrderSubmission,
    RegisterEntry,
    RegisterExport,
    RegisterReconciliation,
    ShareToken,
    SwapApprovalSubmission,
    SwapOrder,
    TransferOrder,
)
from tokens.services import atomic_swap_service, mint_service, swap_approval
from tokens.services.register_events import verify_register
from tokens.services.register_inclusions import waiting_effects
from tokens.services.register_openings import decide_link, prepare_link_review
from tokens.services.settlement_context import settlement_execution_calldata
from tokens.tasks import (
    reconcile_every_register,
    recover_swap_execution,
    resolve_executing_swaps,
)
from tokens.tests.test_chain_integration import (
    CHAIN_SETTINGS,
    SettlementChainMixin,
    chain_available,
    reset_chain_client,
)
from tokens.tests.test_company_pack import (
    INSTRUCTION,
    ISOLATED,
    RECIPIENT,
    consume,
    files_of,
    pack_staff,
    page,
    sha256,
)
from tokens.tests.test_market_summary import TRADING
from users.models import InvestorClassification
from users.services import transition_classification
from users.services.eligibility import investor_eligibility
from whitelist.models import (
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistStatus,
)
from whitelist.tasks import refresh_whitelist_targets

CREATE = "/api/v1/trading/orders/create/"
DEPOSIT = 5000
DEPOSIT_REFERENCE = "SYNTHETIC-DEPOSIT-645-1"
DEPOSIT_DATE = date(2026, 9, 24)
DEPTH_TWO = {"evm:31337": {"mode": "depth", "depth": 2}}
ZERO_ADDRESS = "0x" + "0" * 40


def selector(signature):
    return Web3.to_hex(Web3.keccak(text=signature)[:4])


@chain_available
@override_settings(**CHAIN_SETTINGS)
class DemonstrationJourneyChainTest(SettlementChainMixin, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.settlement_parties()
        self.staff.user_permissions.add(
            *Permission.objects.filter(codename__in=("change_whitelistentry", "change_asset"))
        )
        self._deployed()
        self.assertEqual(swap_approval.recover(self.token.deployment_id), "confirmed")
        for party in (self.seller, self.buyer):
            self._whitelist(
                party.address,
                expires_at=self.classification(party).expires_at,
                authority=WhitelistAuthority.WHITELIST_ADMIN,
            )
        self.assertTrue(self._execute(self._issuance_request(20))["success"])
        self.settlement_payment()
        self.fund_gas()
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        Operator.get().supported_settlement_assets.set([self.tenant.refs.stablecoin])
        self.seller_member, self.buyer_member = str(uuid4()), str(uuid4())
        self.opening = self.open_register({self.seller.address: self.seller_member})
        self.assertEqual(self.opening.applied_entry.changes, [{"member": self.seller_member, "shares": "20"}])
        self.visitor = make_tenant("journey-visitor")
        self.outsider = make_tenant("journey-outsider")
        make_eligible(self.outsider)

    def classification(self, party):
        return InvestorClassification.objects.get(user_account=self.party_accounts[party.address])

    def user_of(self, party):
        return self.party_accounts[party.address].user_profile.user

    def deferred(self, task, **arguments):
        with use_operator():
            return list(
                ProcrastinateJob.objects.filter(
                    task_name=task.name, **{f"args__{name}": value for name, value in arguments.items()}
                )
                .order_by("id")
                .values_list("args", flat=True)
            )

    def refusal(self, party, to, data):
        with self.assertRaises(ContractLogicError) as refused:
            self.w3.eth.call({"from": party.address, "to": to, "data": data})
        return refused.exception.data["data"]

    def broadcast_raw(self, party, to, data):
        signed = party.sign_transaction(
            {
                "to": to,
                "data": data,
                "value": 0,
                "gas": 500000,
                "gasPrice": self.w3.eth.gas_price,
                "nonce": self.w3.eth.get_transaction_count(party.address),
                "chainId": settings.BLOCKCHAIN_CHAIN_ID,
            }
        )
        with suppress(Web3RPCError):
            self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return self.w3.eth.wait_for_transaction_receipt(Web3.keccak(signed.raw_transaction), timeout=10)

    def latest_reconciliation(self):
        return RegisterReconciliation.objects.filter(token=self.token).first()

    def discover(self):
        self.client.force_authenticate(self.user_of(self.buyer))
        market = self.client.get(TRADING)
        self.assertEqual(market.status_code, 200, market.content)
        row = {row["uuid"]: row for row in market.json()["results"]}[str(self.token.pk)]
        self.assertEqual(
            (row["symbol"], row["contractAddress"], row["bestAsk"]),
            (self.token.symbol, self.token.contract_address, None),
        )
        self.client.force_authenticate(self.visitor.user)
        self.assertEqual(self.client.get(TRADING).json()["results"], [])
        phantom = self.client.get(f"{TRADING}{uuid4()}/")
        hidden = self.client.get(f"{TRADING}{self.token.pk}/")
        self.assertEqual((hidden.status_code, hidden.content), (404, phantom.content))

    def list_shares(self):
        body = self.signed_order(self.seller, "sell")
        created = self.client.post(CREATE, body, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertIsNone(created.json()["match"])
        listing = TransferOrder.objects.get(pk=created.json()["order"]["uuid"])
        self.assertEqual(
            (listing.order_type, listing.status, listing.quantity, listing.price_per_share, listing.wallet_address),
            ("sell", "open", 10, Decimal("1.50"), self.seller.address),
        )
        replayed = self.client.post(CREATE, body, format="json")
        self.assertEqual((replayed.status_code, replayed.json()["order"]["uuid"]), (200, str(listing.pk)))
        self.assertEqual(TransferOrder.objects.filter(token=self.token).count(), 1)
        self.client.force_authenticate(self.user_of(self.buyer))
        market = self.client.get(f"{TRADING}{self.token.pk}/")
        self.assertEqual((market.status_code, market.json()["bestAsk"]), (200, "1.50"))
        return listing

    def record_deposit(self):
        before = self.balances()
        request = mint_service.create_request(
            uuid4(),
            self.staff,
            settlement_asset=self.tenant.refs.stablecoin,
            recipient_address=self.buyer.address,
            recipient_name="Synthetic buyer",
            amount=DEPOSIT,
            deposit_reference=DEPOSIT_REFERENCE,
            deposit_date=DEPOSIT_DATE,
        )
        tx_hash, _ = mint_service.execute(request, self.staff, permission="assets.change_asset")
        request.refresh_from_db()
        self.assertEqual(
            (
                request.status,
                request.recipient_address,
                request.amount,
                request.deposit_reference,
                request.deposit_date,
            ),
            (MintRequestStatus.EXECUTED, self.buyer.address, DEPOSIT, DEPOSIT_REFERENCE, DEPOSIT_DATE),
        )
        self.assertEqual((request.transaction.tx_hash, request.executed_by_id), (tx_hash, self.staff.pk))
        receipt = self.w3.eth.get_transaction_receipt(tx_hash)
        (minted,) = self.payment.events.Transfer().process_receipt(receipt)
        self.assertEqual(
            (receipt["status"], minted["args"]["from"], minted["args"]["to"], minted["args"]["value"]),
            (1, ZERO_ADDRESS, self.buyer.address, DEPOSIT),
        )
        self.assertEqual(self.balances(), (*before[:3], before[3] + DEPOSIT))
        return request

    def accept(self, listing):
        before = self.balances()
        created = self.signed_http_order(self.buyer, "buy")
        self.assertEqual(created["match"]["counterOrder"], str(listing.pk))
        swap = SwapOrder.objects.get(pk=created["match"]["swapOrder"])
        bid = TransferOrder.objects.get(pk=created["order"]["uuid"])
        acceptance = OrderSubmission.objects.select_related("executed_challenge").get(order=bid)
        self.assertEqual(
            (acceptance.status, acceptance.initial_counter_order_id, acceptance.initial_swap_id),
            ("created", listing.pk, swap.pk),
        )
        self.assertEqual(acceptance.executed_challenge.wallet_address, self.buyer.address)
        self.assertIsNotNone(acceptance.executed_challenge.consumed_at)
        self.assertEqual(
            (swap.status, swap.share_amount, swap.payment_amount, swap.seller_address, swap.buyer_address),
            ("created", 10, 1500, self.seller.address, self.buyer.address),
        )
        self.assertEqual((swap.transaction_id, swap.tx_hash), (None, ""))
        self.assertEqual(self.balances(), before)
        return acceptance, swap, (listing, bid)

    def approve(self, swap, orders):
        for party in (self.seller, self.buyer):
            approval = WhitelistApproval.objects.get(
                entry__wallet=self.party_wallets[party.address], company=self.token.company
            )
            change = WhitelistChange.objects.get(entry_id=approval.entry_id, action="add")
            registry = self.chain.load_contract(
                "WhitelistRegistry", Web3.to_checksum_address(approval.registry_address)
            )
            self.assertEqual(
                (change.status, change.authority, change.initiated_by_id, approval.status, approval.expires_at),
                (
                    "confirmed",
                    WhitelistAuthority.WHITELIST_ADMIN,
                    self.staff.pk,
                    WhitelistStatus.ACTIVE,
                    change.expires_at,
                ),
            )
            expiry = int(change.expires_at.timestamp())
            sent = self.w3.eth.get_transaction(change.transaction.tx_hash)
            self.assertEqual(
                (sent["to"], Web3.to_hex(sent["input"])),
                (
                    registry.address,
                    selector("setExpiry(address,uint64)")
                    + encode(["address", "uint64"], [party.address, expiry]).hex(),
                ),
            )
            self.assertEqual(registry.functions.expiresAt(party.address).call(), expiry)
            self.assertGreater(expiry, self.w3.eth.get_block("latest")["timestamp"])
            self.assertTrue(registry.functions.isWhitelisted(party.address).call())
            self.assertTrue(investor_eligibility(self.user_of(party), self.token.company).is_eligible)
        signatures = []
        for party, order, status in zip((self.seller, self.buyer), orders, ("seller_signed", "executing")):
            approved = self.broadcast_approval(swap, order, self.signed_approval(swap, order, party))
            self.assertEqual(approved.status_code, 200, approved.content)
            self.assertEqual(SwapApprovalSubmission.objects.get(tx_hash=approved.json()["txHash"]).outcome, "confirmed")
            signatures.append(self.typed_signature(swap, order, party))
            signed = self.post_signature(swap, order, party, signatures[-1])
            self.assertEqual(signed.status_code, 200, signed.content)
            swap.refresh_from_db()
            self.assertEqual(swap.status, status)
        allowances = atomic_swap_service.check_swap_allowances(swap)
        self.assertTrue(allowances["seller"]["has_sufficient_allowance"])
        self.assertTrue(allowances["buyer"]["has_sufficient_allowance"])
        return signatures[-1]

    def transfer(self, swap, orders, signature):
        before = self.balances()
        nonce = self._signer_nonce()
        (job,) = self.deferred(recover_swap_execution, transaction_id=str(swap.transaction_id))
        self.assertEqual(recover_swap_execution(**job), "confirmed")
        swap.refresh_from_db()
        receipt = self.w3.eth.get_transaction_receipt(swap.tx_hash)
        atomic_swap = self.chain.load_contract("AtomicSwap", settings.ATOMIC_SWAP_ADDRESS)
        (executed,) = atomic_swap.events.SwapExecuted().process_receipt(receipt)
        self.assertEqual(
            (receipt["status"], receipt["from"], receipt["to"]),
            (1, Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address, atomic_swap.address),
        )
        self.assertEqual(
            [executed["args"][name] for name in ("seller", "buyer", "shareAmount", "paymentAmount")],
            [self.seller.address, self.buyer.address, 10, 1500],
        )
        self.assertEqual(self.balances(), (before[0] - 10, before[1] + 10, before[2] + 1500, before[3] - 1500))
        self.assertEqual((swap.status, swap.transaction.status), ("executing", "confirmed"))
        replayed = self.post_signature(swap, orders[1], self.buyer, signature)
        self.assertEqual(replayed.status_code, 200, replayed.content)
        jobs = self.deferred(recover_swap_execution, transaction_id=str(swap.transaction_id))
        self.assertEqual(len(jobs), 2)
        for job in jobs:
            self.assertEqual(recover_swap_execution(**job), "confirmed")
        self.assertEqual(swap.transaction.outgoing_operation.attempts.count(), 1)
        self.assertEqual(self._signer_nonce(), nonce + 1)
        return receipt

    def finalise(self, swap, orders, receipt):
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=DEPTH_TWO):
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 0})
            swap.refresh_from_db()
            self.assertEqual((swap.status, swap.completed_at), ("executing", None))
            self.w3.provider.make_request("evm_mine", [])
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 1})
        swap.refresh_from_db()
        self.assertEqual(
            (swap.status, swap.finalized_receipt["block_number"], swap.finalized_receipt["policy"]),
            ("completed", receipt["blockNumber"], {"version": 1, "mode": "depth", "depth": 2}),
        )
        self.assertEqual(
            [
                (order.status, order.filled_quantity)
                for order in TransferOrder.objects.filter(pk__in=[o.pk for o in orders])
            ],
            [("completed", 10)] * 2,
        )

    def trade(self):
        listing = self.list_shares()
        deposit = self.record_deposit()
        acceptance, swap, orders = self.accept(listing)
        signature = self.approve(swap, orders)
        self.finalise(swap, orders, self.transfer(swap, orders, signature))
        return deposit, acceptance, swap, orders

    def waiting(self):
        self.client.force_authenticate(self.tenant.user)
        response = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/waiting/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["effects"]

    def link_buyer(self):
        self.client.force_authenticate(self.tenant.user)
        linked = self.client.post(
            "/api/v1/tokens/register-links/",
            {
                "operation_id": str(uuid4()),
                "company_id": str(self.token.company_id),
                "document_id": str(self.document.pk),
                "mapping": [{"address": self.buyer.address, "member": self.buyer_member}],
                "authority": "director_resolution",
                "approving_director": "Synthetic Director",
                "authority_reference": "SYNTHETIC-RESOLUTION-LINK-1",
                "reason": "Enter the buyer as a member of the company",
            },
            format="json",
        )
        self.assertEqual(linked.status_code, 201, linked.content)
        self.reviewer.user_permissions.add(Permission.objects.get(codename="change_registerwalletlink"))
        _, confirmation = prepare_link_review(proposal_id=linked.json()["uuid"], reviewer=self.reviewer)
        return decide_link(
            proposal_id=linked.json()["uuid"], reviewer=self.reviewer, confirmation=confirmation, decision="apply"
        )

    def reconcile(self, swap):
        self.assertEqual(reconcile_every_register(), {"matched": 1, "discrepant": 0, "failed": 0})
        compared = self.latest_reconciliation()
        self.assertEqual((compared.status, compared.discrepancies, compared.register_sequence), ("matched", [], 1))
        (effect,) = self.waiting()
        self.assertEqual(
            [effect[key] for key in ("kind", "source", "wallets", "shares", "reason", "unlinkedWallets")],
            [
                "transfer",
                str(swap.pk),
                [self.seller.address, self.buyer.address],
                "10",
                "unlinked",
                [self.buyer.address],
            ],
        )
        link = self.link_buyer()
        (effect,) = self.waiting()
        self.assertEqual(effect["reason"], "uninstructed")
        operation_id = uuid4()
        instruction = self.instruct_transfer(effect, operation_id)
        self.assertEqual(instruction.status_code, 201, instruction.content)
        self.assertFalse(RegisterEntry.objects.filter(kind="transfer").exists())
        self.apply_instruction(instruction.json()["uuid"])
        entry = RegisterEntry.objects.get(operation_id=swap.pk)
        self.assertEqual(
            (entry.kind, entry.changes),
            (
                "transfer",
                sorted(
                    [{"member": self.seller_member, "shares": "-10"}, {"member": self.buyer_member, "shares": "10"}],
                    key=lambda change: change["member"],
                ),
            ),
        )
        replayed = self.instruct_transfer(effect, operation_id)
        self.assertEqual(
            (replayed.status_code, replayed.json()["uuid"], replayed.json()["status"]),
            (201, instruction.json()["uuid"], "applied"),
        )
        repeated = self.instruct_transfer(effect)
        self.assertEqual(repeated.status_code, 400, repeated.content)
        self.assertEqual(RegisterEntry.objects.filter(kind="transfer").count(), 1)
        self.assertEqual((waiting_effects(self.token.pk), self.waiting()), (0, []))
        self.assertEqual(verify_register(entry.register_id)["issued_supply"], "20")
        holders = self.client.get(f"/api/v1/tokens/{self.token.pk}/holders/").json()["holders"]
        self.assertEqual(
            sorted((holder["member"], holder["balance"]) for holder in holders),
            sorted([(self.seller_member, "10"), (self.buyer_member, "10")]),
        )
        self.assertEqual(reconcile_every_register(), {"matched": 1, "discrepant": 0, "failed": 0})
        matched = self.latest_reconciliation()
        self.assertEqual((matched.status, matched.discrepancies, matched.register_sequence), ("matched", [], 2))
        return entry, instruction.json()["uuid"], link

    def walk(self):
        self.discover()
        deposit, acceptance, swap, orders = self.trade()
        entry, instruction, link = self.reconcile(swap)
        return SimpleNamespace(
            deposit=deposit,
            acceptance=acceptance,
            swap=swap,
            orders=orders,
            entry=entry,
            instruction=instruction,
            link=link,
        )

    def carry(self, journey):
        company = Company.objects.get(pk=self.token.company_id)
        self.client.force_login(pack_staff("journey-pack-staff"))
        with override_settings(STORAGES=ADMIN_STORAGES):
            produced = self.client.post(page(company), {"instruction": INSTRUCTION, "recipient": RECIPIENT})
        self.assertEqual((produced.status_code, produced["Content-Type"]), (200, "application/zip"))
        content = b"".join(produced.streaming_content)
        files = files_of(content)
        digest = sha256(files["manifest.json"])
        self.assertEqual(
            sorted(
                RegisterExport.objects.filter(kind="company_pack").values_list(
                    "token_id", "digest", "instruction", "recipient"
                )
            ),
            sorted(
                (token, digest, INSTRUCTION, RECIPIENT)
                for token in ShareToken.objects.filter(company=company).values_list("pk", flat=True)
            ),
        )
        consumed = consume(content, *ISOLATED)
        self.assertEqual((consumed.returncode, consumed.stderr), (0, ""))
        read = consumed.stdout.splitlines()
        self.assertIn(f"{self.token.symbol}: 2 entries verified, 2 current members", read)
        self.assertEqual(read[-1], digest)
        folder = f"classes/{self.token.pk}"
        (settled,) = json.loads(files[f"{folder}/settlements.json"])
        self.assertEqual(
            (settled["uuid"], settled["status"], settled["transaction"], settled["entry"]),
            (str(journey.swap.pk), "completed", journey.swap.transaction.tx_hash, str(journey.entry.pk)),
        )
        receipt = self.w3.eth.get_transaction_receipt(settled["transaction"])
        self.assertEqual(
            (receipt["status"], receipt["to"], receipt["blockNumber"]),
            (1, Web3.to_checksum_address(settings.ATOMIC_SWAP_ADDRESS), settled["finalized_receipt"]["block_number"]),
        )
        opening, transfer = json.loads(files[f"{folder}/entries.json"])
        self.assertEqual(
            (
                opening["kind"],
                transfer["kind"],
                transfer["operation_id"],
                transfer["changes"],
                transfer["entry_hash"],
                transfer["previous_hash"],
            ),
            (
                "opening",
                "transfer",
                str(journey.swap.pk),
                journey.entry.changes,
                journey.entry.entry_hash,
                opening["entry_hash"],
            ),
        )

    def test_the_demonstration_journey_runs_from_discovery_to_a_company_pack_read_without_the_platform(self):
        journey = self.walk()
        journey.swap.refresh_from_db()
        events = [
            journey.deposit.executed_at,
            journey.acceptance.resolved_at,
            journey.swap.completed_at,
            journey.entry.created_at,
        ]
        self.assertEqual(sorted(events), events)
        self.assertEqual(len(set(events)), 4)
        self.assertNotEqual(journey.deposit.transaction.tx_hash, journey.swap.tx_hash)
        self.carry(journey)

    def test_a_revoked_buyer_is_removed_from_the_registry_and_can_neither_list_nor_transfer(self):
        self.trade()
        share = self._contract()
        self.assertTrue(share.functions.transfer(self.seller.address, 1).call({"from": self.buyer.address}))
        transition_classification(
            self.classification(self.buyer), "revoke", reviewed_by=self.staff, reason="The buyer no longer qualifies"
        )
        (job,) = self.deferred(refresh_whitelist_targets, actor_id=str(self.staff.pk))
        refreshed = refresh_whitelist_targets(**job)
        approval = WhitelistApproval.objects.get(entry__wallet=self.party_wallets[self.buyer.address])
        registry = self.chain.load_contract("WhitelistRegistry", Web3.to_checksum_address(approval.registry_address))
        self.assertEqual(
            (
                registry.functions.expiresAt(self.buyer.address).call(),
                registry.functions.isWhitelisted(self.buyer.address).call(),
            ),
            (0, False),
        )
        self.assertEqual(refreshed, {"checked": 1, "submitted": 1, "errors": 0})
        removal = WhitelistChange.objects.get(authority=WhitelistAuthority.CLASSIFICATION_REFRESH)
        self.assertEqual(
            (removal.action, removal.status, removal.address), ("remove", "confirmed", self.buyer.address.lower())
        )
        self.assertEqual(approval.status, WhitelistStatus.REMOVED)
        refused = self.client.post(CREATE, self.signed_order(self.buyer, "sell"), format="json")
        self.assertEqual((refused.status_code, refused.json()["refusal"]["code"]), (400, "not_whitelisted"))
        self.assertFalse(TransferOrder.objects.filter(wallet_address=self.buyer.address, order_type="sell").exists())
        before = self.balances()
        transfer = share.functions.transfer(self.seller.address, 1)._encode_transaction_data()
        self.assertEqual(
            self.refusal(self.buyer, share.address, transfer),
            selector("SenderNotWhitelisted(address)") + encode(["address"], [self.buyer.address]).hex(),
        )
        self.assertEqual(self.broadcast_raw(self.buyer, share.address, transfer)["status"], 0)
        self.assertEqual(self.balances(), before)

    def test_direct_calls_to_the_share_and_swap_contracts_revert_on_the_node(self):
        listing = self.list_shares()
        self.record_deposit()
        _, swap, orders = self.accept(listing)
        signature = self.approve(swap, orders)
        share = self._contract()
        stranger = Account.create().address
        before = self.balances()
        self.assertTrue(share.functions.transfer(self.buyer.address, 1).call({"from": self.seller.address}))
        transfer = share.functions.transfer(stranger, 1)._encode_transaction_data()
        self.assertEqual(
            self.refusal(self.seller, share.address, transfer),
            selector("RecipientNotWhitelisted(address)") + encode(["address"], [stranger]).hex(),
        )
        self.assertEqual(self.broadcast_raw(self.seller, share.address, transfer)["status"], 0)
        swap.refresh_from_db()
        execution = settlement_execution_calldata(swap.transaction.function_args)
        self.assertEqual(self.refusal(self.buyer, settings.ATOMIC_SWAP_ADDRESS, execution), selector("NotRelayer()"))
        self.assertEqual(self.broadcast_raw(self.buyer, settings.ATOMIC_SWAP_ADDRESS, execution)["status"], 0)
        self.assertEqual((self.balances(), share.functions.balanceOf(stranger).call()), (before, 0))
        receipt = self.transfer(swap, orders, signature)
        self.assertEqual(Web3.to_hex(self.w3.eth.get_transaction(receipt["transactionHash"])["input"]), execution)

    def test_register_reconciliation_fails_closed_while_the_provider_is_unreachable_and_then_recovers(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            unreachable = f"http://127.0.0.1:{probe.getsockname()[1]}"
        self.addCleanup(reset_chain_client)
        with override_settings(BLOCKCHAIN_RPC_URL=unreachable):
            reset_chain_client()
            with self.assertRaisesMessage(RuntimeError, "Register reconciliation failed for 1 share classes."):
                reconcile_every_register()
        failed = RegisterReconciliation.objects.get(token=self.token)
        self.assertEqual(
            (failed.status, failed.block_number, failed.register_sequence, failed.failure),
            ("failed", None, None, "A complete canonical register snapshot could not be read."),
        )
        reset_chain_client()
        self.assertEqual(reconcile_every_register(), {"matched": 1, "discrepant": 0, "failed": 0})
        recovered = self.latest_reconciliation()
        self.assertEqual(
            (recovered.status, recovered.discrepancies, recovered.register_sequence, recovered.block_number),
            ("matched", [], 1, self.w3.eth.block_number),
        )

    def test_another_tenant_reaches_none_of_the_journeys_records(self):
        journey = self.walk()
        listing, bid = journey.orders
        token = f"/api/v1/tokens/{self.token.pk}"
        seller_identity = f"owner_account_uuid={self.tenant.account.pk}&wallet_uuid={listing.wallet_id}"
        outsider_identity = f"owner_account_uuid={self.outsider.account.pk}&wallet_uuid={self.outsider.wallet.pk}"
        swap = f"/api/v1/trading/orders/{listing.pk}/swap/?swap_uuid={journey.swap.pk}&"
        routes = (
            (self.tenant.user, f"/api/v1/trading/orders/{listing.pk}/", None),
            (self.user_of(self.buyer), f"/api/v1/trading/orders/{bid.pk}/", None),
            (self.tenant.user, swap + seller_identity, swap + outsider_identity),
            (self.tenant.user, f"/api/v1/trading/swaps/?wallet_address={self.seller.address}", None),
            (self.tenant.user, f"{token}/holders/", None),
            (self.tenant.user, f"{token}/register/waiting/", None),
            (self.tenant.user, f"{token}/register/export/", None),
            (self.tenant.user, f"/api/v1/tokens/register-openings/{self.opening.pk}/", None),
            (self.tenant.user, f"/api/v1/tokens/register-links/{journey.link.pk}/", None),
            (self.tenant.user, f"/api/v1/tokens/register-instructions/{journey.instruction}/", None),
            (self.tenant.user, f"/api/v1/tokens/register-instructions/{journey.instruction}/file/", None),
        )
        for party, path, foreign in routes:
            with self.subTest(path=path):
                self.client.force_authenticate(party)
                self.assertEqual(self.client.get(path).status_code, 200)
                self.client.force_authenticate(self.outsider.user)
                self.assertEqual(self.client.get(foreign or path).status_code, 404)
        self.client.force_authenticate(self.outsider.user)
        listed = {order["uuid"] for order in self.client.get("/api/v1/trading/orders/").json()["results"]}
        self.assertIn(str(self.outsider.order.pk), listed)
        self.assertFalse({str(listing.pk), str(bid.pk)} & listed)
        exports = RegisterExport.objects.count()
        company = Company.objects.get(pk=self.token.company_id)
        self.client.force_login(self.outsider.user)
        for response in (
            self.client.get(page(company)),
            self.client.post(page(company), {"instruction": "x", "recipient": "y"}),
        ):
            self.assertEqual((response.status_code, response["Location"].split("?")[0]), (302, reverse("admin:login")))
        self.assertEqual(RegisterExport.objects.count(), exports)
        self.client.force_login(pack_staff("journey-pack-staff"))
        with override_settings(STORAGES=ADMIN_STORAGES):
            self.assertEqual(self.client.get(page(company)).status_code, 200)
