import ipaddress
import logging
import socket
import time
from collections import defaultdict
from contextlib import ExitStack
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from assets.models import Asset
from blockchain.models import SignedAttempt
from blockchain.services.local_signer import admit_local_signer
from feature_flags.models import FeatureFlag
from integrations.base_chain import get_base_chain_client
from integrations.blockchain import BlockchainClientFactory
from ledova_backend.procrastinate_app import app
from offerings.models import Offering, OfferingStatus, SubscriptionStatus
from operators.services import SEVERITY_DANGER, configuration_health, worklist
from shared.db import use_operator
from shared.seeds.demo import DEMO_ADMIN_EMAIL, DEMO_INVESTOR_EMAIL, DEMO_OWNER_EMAIL
from shared.seeds.synthetic.chain.deferred import captured
from shared.seeds.synthetic.chain.guard import operator_address
from shared.seeds.synthetic.chain.settlement import fund_wallets
from shared.seeds.synthetic.chain.story import TESTER_WALLETS
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.market import layer as market_layer
from shared.seeds.synthetic.market.deposits import mint_id
from shared.seeds.synthetic.market.notices import Notices
from shared.seeds.synthetic.market.story import MARKETS
from shared.services.orphaned_files import orphaned_files
from shareholders.models import (
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationRecipient,
)
from shareholders.services.resolutions import verify_publication
from tokens.models import (
    MintRequest,
    RegisterEntry,
    RegisterReconciliation,
    RegisterReconciliationStatus,
    ShareIssuance,
    ShareToken,
    SwapOrder,
    SwapOrderStatus,
    TransferOrder,
)
from tokens.services import share_token_service
from tokens.services.register_inclusions import waiting_effects
from tokens.tests.test_chain_integration import (
    CHAIN_SETTINGS,
    chain_available,
    reset_chain_client,
)
from users.models import DeviceToken, Notification
from users.tasks.notifications import send_push_notification
from wallets.models import Holding, Wallet
from whitelist.models import WhitelistApproval

User = get_user_model()
PASSWORD = "pw-12345678"
OUTSIDE_WORLD = (
    "integrations.expo_push.client.ExpoPushClient.send_batch",
    "integrations.sendgrid_email.client.SendGridClient.send_email",
    "companies.services.registry.lookup_company",
    "users.services.identity.get_kyc_provider",
    "integrations.llm_extract.client.LlmExtractClient.extract",
)
PRICE_FEED = (
    ("integrations.coingecko.CoinGeckoClient.fetch_prices_by_symbols", {"side_effect": RuntimeError("offline")}),
    ("integrations.coingecko.CoinGeckoClient.fetch_exchange_rate", {"return_value": None}),
    ("integrations.coingecko.CoinGeckoClient.fetch_historical_prices_bulk", {"side_effect": RuntimeError("offline")}),
)
UNTOUCHED_APPS = ("procrastinate", "sessions", "admin", "contenttypes")
BOOKKEEPING = {
    "updated_at",
    "last_synced_at",
    "balance_version",
    "sync_version",
    "former_holders_folded_at",
    "former_holders_block",
}
APPENDED_BY_DESIGN = {"tokens.RegisterReconciliation", "assets.AssetSnapshot"}
ADMIN_PAGES = (
    "/admin/operators/operator/",
    "/admin/tokens/mintrequest/",
    "/admin/tokens/transferorder/",
    "/admin/tokens/swaporder/",
    "/admin/tokens/ordersubmission/",
    "/admin/tokens/registerinstruction/",
    "/admin/tokens/registerwalletlink/",
    "/admin/shareholders/publication/",
)
SAFE_ROWS = (
    "Offerings awaiting review",
    "Subscriptions awaiting payment",
    "Subscriptions paid and not allotted",
    "Share issuance requests needing attention",
    "Capital increase requests needing attention",
)
AUDY_DECIMALS = 2
MARKET_SEED = "shared.seeds.synthetic.market.layer.seed_market"
EXPO_TOKEN = "ExponentPushToken[seed-test-last-step]"
LAST_STEPS = (
    ("shared.seeds.synthetic.chain.layer.fund_wallets", fund_wallets, "Queued by the chain layer's last step"),
    ("shared.seeds.synthetic.market.layer.Notices.close", Notices.close, "Queued by the market layer's last step"),
)
real_connect = socket.socket.connect


def pushing_after(step, title):
    def last_step(*args, **kwargs):
        result = step(*args, **kwargs)
        investor = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        DeviceToken.objects.get_or_create(
            push_token=EXPO_TOKEN,
            defaults={"user": investor, "device_type": DeviceToken.DeviceType.IOS, "is_active": True},
        )
        send_push_notification.defer(user_id=investor.pk, title=title, body=title)
        return result

    return last_step


def recording(step, outcomes):
    def recorded(*args, **kwargs):
        outcome = step(*args, **kwargs)
        outcomes.append(outcome)
        return outcome

    return recorded


def listed(response):
    payload = response.json()
    return payload["results"] if isinstance(payload, dict) else payload


def rows():
    state = {}
    for model in apps.get_models():
        if model._meta.app_label in UNTOUCHED_APPS or not model._meta.managed or model._meta.proxy:
            continue
        state[model._meta.label] = {row[model._meta.pk.attname]: row for row in model._base_manager.values()}
    return state


def changes(before, after):
    found = {}
    for label, now in after.items():
        then = before.get(label, {})
        fields = defaultdict(set)
        for key in set(then) & set(now):
            for field, value in now[key].items():
                if then[key].get(field) != value:
                    fields[field].add(key)
        created, deleted = set(now) - set(then), set(then) - set(now)
        if created or deleted or fields:
            found[label] = {"created": created, "deleted": deleted, "fields": dict(fields)}
    return found


@chain_available
@override_settings(DEBUG=True, **CHAIN_SETTINGS)
class ChainLayerTest(APITransactionTestCase):

    def setUp(self):
        super().setUp()
        reset_chain_client()
        BlockchainClientFactory._clients.clear()
        self.addCleanup(BlockchainClientFactory._clients.clear)
        self.w3 = get_base_chain_client().w3
        snapshot = self.w3.provider.make_request("evm_snapshot", [])["result"]
        self.addCleanup(self.w3.provider.make_request, "evm_revert", [snapshot])
        call_command("sync_monitoring_rules", stdout=StringIO())
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        with use_operator():
            admit_local_signer()
        self.outbound = []

    def only_local(self):
        def connect(sock, address):
            host = address[0] if isinstance(address, tuple) else address
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local = host == "localhost"
            if not local:
                self.outbound.append(host)
                raise ConnectionRefusedError("The seed test allows only the local chain.")
            return real_connect(sock, address)

        return patch.object(socket.socket, "connect", connect)

    def seed(self, *last_steps):
        output = StringIO()
        self.markets = []
        with ExitStack() as stack:
            stubs = {target: stack.enter_context(patch(target)) for target in OUTSIDE_WORLD}
            stack.enter_context(self.only_local())
            stack.enter_context(patch(MARKET_SEED, recording(market_layer.seed_market, self.markets)))
            for target, step, title in last_steps:
                stack.enter_context(patch(target, pushing_after(step, title)))
            call_command("seed_demo", stdout=output, password=PASSWORD)
        for target, stub in stubs.items():
            self.assertFalse(stub.called, target)
        return output.getvalue()

    def spent_by(self, address, start):
        spent = 0
        for number in range(start + 1, self.w3.eth.block_number + 1):
            for tx in self.w3.eth.get_block(number, full_transactions=True).transactions:
                if tx["from"] == address:
                    receipt = self.w3.eth.get_transaction_receipt(tx["hash"])
                    spent += tx["value"] + receipt["gasUsed"] * receipt["effectiveGasPrice"]
        return spent

    def operator_ether(self):
        wallet = Wallet.objects.filter_by_address(operator_address(), chain="base").get()
        return Holding.objects.get(wallet=wallet, asset__symbol="ETH")

    def test_a_fresh_database_gets_a_coherent_chain_layer_that_the_periodic_jobs_leave_alone(self):
        jobs = ProcrastinateJob.objects.count()
        operator = operator_address()
        start, funds = self.w3.eth.block_number, self.w3.eth.get_balance(operator)
        output = self.seed(*LAST_STEPS)

        self.assertIn("Chain layer added", output, output)
        self.assertIn("Market layer added", output, output)
        self.assertEqual(self.w3.eth.get_balance(operator), funds - self.spent_by(operator, start))
        self.assertEqual(self.outbound, [])
        self.assertEqual(mail.outbox, [])
        self.assertEqual(ProcrastinateJob.objects.count(), jobs)
        self.check_last_steps()
        self.check_mints()
        self.check_registers()
        self.check_console()
        self.check_investor_screens()
        self.check_founder_screens()
        self.check_market()
        self.check_notices()
        self.check_admin()
        self.check_quiet_jobs(timedelta(0))
        self.check_quiet_jobs(timedelta(minutes=20))
        self.check_quiet_jobs(timedelta(hours=26))
        self.assertEqual(orphaned_files(moment=timezone.now() + timedelta(days=2)), [])

        counted = (SignedAttempt, ShareToken, MintRequest, TransferOrder, SwapOrder, Publication, PublicationEvent)
        before = [model.objects.count() for model in counted]
        second = self.seed()

        self.assertIn("Chain layer already present; nothing added.", second)
        self.assertIn("Market layer already present; nothing added.", second)
        self.assertEqual([model.objects.count() for model in counted], before)

    def check_last_steps(self):
        investor = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        device = DeviceToken.objects.get(push_token=EXPO_TOKEN)
        self.assertEqual((device.user, device.is_active), (investor, True))
        for _, _, title in LAST_STEPS:
            self.assertEqual(Notification.objects.filter(user=investor, title=title).count(), 1, title)
        device.delete()

    def check_mints(self):
        [market] = self.markets
        audy = Asset.objects.get(symbol="AUDY").get_deployment_for_chain("base")
        self.assertEqual(audy.decimals, AUDY_DECIMALS)
        for deposit in market.plan.deposits:
            request = MintRequest.objects.get(pk=mint_id(deposit.key))
            planned = int(deposit.amount * 10**AUDY_DECIMALS)
            self.assertEqual((request.status, request.amount), (deposit.state, planned), deposit.key)

    def check_registers(self):
        on_chain = ShareToken.objects.exclude(contract_address=None)
        self.assertEqual(sorted(on_chain.values_list("status", flat=True)), ["deployed"] * 4 + ["paused"])
        self.assertEqual(ShareToken.objects.filter(status="draft").count(), 2)
        for token in on_chain:
            record = RegisterReconciliation.objects.filter(token=token).first()
            self.assertEqual(record.status, RegisterReconciliationStatus.MATCHED, token.symbol)
            self.assertEqual(waiting_effects(token.pk), 0, token.symbol)
            self.assertTrue(token.register_imports.filter(status="applied").exists(), token.symbol)
            contract = share_token_service.load_share_token(token.contract_address)
            minted = ShareIssuance.objects.filter(token=token, status="completed")
            holders = {issuance.recipient_address.lower() for issuance in minted}
            self.assertTrue(10 <= len(holders) <= 30, (token.symbol, len(holders)))
            wallets = {
                address for address in holders if Wallet.objects.filter_by_address(address, chain="base").exists()
            }
            shares = Holding.objects.filter(asset__chain_deployments__contract_address__iexact=token.contract_address)
            settled = SwapOrder.objects.filter(share_token=token, status="completed")
            bought = {swap.buyer_address.lower() for swap in settled}
            held = {holding.wallet.address.lower() for holding in shares.select_related("wallet")}
            self.assertTrue(wallets <= held <= wallets | bought, token.symbol)
            self.assertLessEqual(bought, held, token.symbol)
            for holding in shares.select_related("wallet"):
                balance = contract.functions.balanceOf(holding.wallet.address).call()
                self.assertEqual(holding.quantity, Decimal(balance), holding.wallet.address)
            transfers = RegisterEntry.objects.filter(register__token=token, kind="transfer")
            self.assertEqual(
                set(transfers.values_list("operation_id", flat=True)), set(settled.values_list("pk", flat=True))
            )
        for approval in WhitelistApproval.objects.select_related("entry__wallet__user_account"):
            self.assertEqual(approval.status, "active")
            if approval.entry.wallet_id:
                self.assertEqual(approval.entry.wallet.user_account.account_status, "active")

    def check_console(self):
        rows = {row.label: row for row in worklist()}

        self.assertTrue(all(check.ok for check in configuration_health()), configuration_health())
        for row in rows.values():
            if row.severity == SEVERITY_DANGER:
                self.assertEqual(row.count, 0, row.label)
        for label in SAFE_ROWS:
            self.assertGreater(rows[label].count, 0, label)
        self.assertEqual(rows["Whitelist approvals pending"].count, 0)
        self.assertEqual(set(Offering.objects.values_list("status", flat=True)), set(OfferingStatus.values))

    def check_investor_screens(self):
        investor = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        self.client.force_authenticate(investor)
        held = defaultdict(set)
        for wallet in Wallet.objects.filter(user_account__user_profile__user=investor, chain="base"):
            if wallet.verification_status != "VERIFIED":
                continue
            response = self.client.get(f"/api/wallets/{wallet.uuid}/holdings/")
            self.assertEqual(response.status_code, 200, response.content)
            for row in listed(response):
                if row.get("shareClass"):
                    held[row["shareClass"]["companyName"]].add((row["shareClass"]["uuid"], wallet.address))
            balances = self.client.get("/api/v1/trading/wallets/balances/", {"wallet_address": wallet.address})
            self.assertEqual(balances.status_code, 200, balances.content)
        classes = {share_class for rows in held.values() for share_class, _ in rows}
        wallets = {address for rows in held.values() for _, address in rows}
        self.assertEqual((len(held), len(classes)), (3, 4))
        self.assertEqual(wallets, set(TESTER_WALLETS.values()))
        applications = listed(self.client.get("/api/v1/subscriptions/"))
        self.assertTrue({"awaiting_payment", "paid", "allotted"} <= {row["status"] for row in applications})
        directory = self.client.get("/api/v1/directory/tokens/")
        self.assertEqual(directory.status_code, 200, directory.content)
        self.assertTrue(directory.json())

    def check_founder_screens(self):
        founder = User.objects.get(email=DEMO_OWNER_EMAIL)
        self.client.force_authenticate(founder)
        tokens = listed(self.client.get("/api/v1/tokens/"))
        deployed = [token for token in tokens if token["status"] == "deployed"]
        self.assertEqual(len(deployed), 2)
        for token in deployed:
            holders = self.client.get(f"/api/v1/tokens/{token['uuid']}/holders/").json()
            self.assertEqual((holders["initialized"], holders["waitingEffects"]), (True, 0))
            self.assertTrue(all(holder["name"] and holder["enteredOn"] for holder in holders["holders"]))
            export = self.client.get(f"/api/v1/tokens/{token['uuid']}/register/export/")
            self.assertEqual(export.status_code, 200)
            self.assertIn("Reconciled with the chain,matched", export.content.decode())
        offerings = listed(self.client.get("/api/v1/offerings/"))
        ledgers = [listed(self.client.get(f"/api/v1/offerings/{row['uuid']}/subscriptions/")) for row in offerings]
        statuses = {row["status"] for ledger in ledgers for row in ledger}
        self.assertEqual(statuses, set(SubscriptionStatus.values))

    def check_market(self):
        investor = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        mine = {
            wallet.address.lower(): wallet
            for wallet in Wallet.objects.filter(
                user_account__user_profile__user=investor, chain="base", verification_status="VERIFIED"
            )
        }
        swaps = SwapOrder.objects.all()
        self.assertGreaterEqual(swaps.filter(status="completed").count(), 15)
        self.assertEqual(swaps.filter(status="expired").count(), 2)
        self.assertEqual(set(swaps.values_list("status", flat=True)), {"completed", "expired"})
        self.client.force_authenticate(investor)
        tokens = listed(self.client.get("/api/v1/trading/tokens/"))
        self.assertEqual(len(tokens), len(MARKETS))
        approved = set(
            WhitelistApproval.objects.filter(entry__wallet__in=mine.values()).values_list(
                "entry__wallet__address", "company__uuid"
            )
        )
        for token in tokens:
            self.assertIsNotNone(token["lastPrice"], token["symbol"])
            self.assertLess(Decimal(token["bestBid"]), Decimal(token["bestAsk"]), token["symbol"])
            book = self.client.get(f"/api/v1/trading/tokens/{token['uuid']}/order-book/").json()
            self.assertGreaterEqual(min(len(book["sellOrders"]), len(book["buyOrders"])), 2, token["symbol"])
            for wallet in mine.values():
                status = self.client.get(
                    f"/api/v1/trading/whitelist/{token['contractAddress']}/{wallet.address}/status/"
                ).json()["status"]
                whitelisted = (wallet.address, token["companyUuid"]) in {
                    (address, str(company)) for address, company in approved
                }
                self.assertEqual(status, "whitelisted" if whitelisted else "not_whitelisted", token["symbol"])
        orders = [
            row for row in listed(self.client.get("/api/v1/trading/orders/")) if row["walletAddress"].lower() in mine
        ]
        self.assertEqual(
            {row["status"] for row in orders}, {"open", "partially_filled", "completed", "cancelled"}, orders
        )
        for wallet in mine.values():
            response = self.client.get("/api/v1/trading/swaps/", {"wallet_address": wallet.address})
            self.assertEqual(response.status_code, 200, response.content)
        held = defaultdict(set)
        for wallet in mine.values():
            for row in listed(self.client.get(f"/api/wallets/{wallet.uuid}/holdings/")):
                if row.get("shareClass"):
                    held[row["shareClass"]["uuid"]].add(wallet.address)
        self.assertTrue(any(len(wallets) > 1 for wallets in held.values()), held)
        audy = Asset.objects.get(symbol="AUDY").get_deployment_for_chain("base")
        stablecoin = get_base_chain_client().load_contract("AUDY", audy.contract_address)
        for holding in Holding.objects.filter(asset__symbol="AUDY").select_related("wallet"):
            balance = stablecoin.functions.balanceOf(Web3.to_checksum_address(holding.wallet.address)).call()
            self.assertEqual(holding.quantity, Decimal(balance) / 10**audy.decimals, holding.wallet.address)
        traders = {address.lower() for swap in swaps for address in (swap.seller_address, swap.buyer_address)}
        for address in traders:
            ether = Holding.objects.filter(wallet__address__iexact=address, wallet__chain="base", asset__symbol="ETH")
            seeded = ether.first().quantity if ether.exists() else Decimal(0)
            on_chain = Web3.from_wei(self.w3.eth.get_balance(Web3.to_checksum_address(address)), "ether")
            self.assertEqual(seeded, on_chain, address)
        self.assertEqual(set(MintRequest.objects.values_list("status", flat=True)), {"executed", "pending", "rejected"})

    def check_notices(self):
        investor = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        self.client.force_authenticate(investor)
        first = self.client.get("/api/v1/publications/", {"addressed": "me"}).json()
        second = self.client.get("/api/v1/publications/", {"addressed": "me", "page": 2}).json()
        self.assertGreater(first["count"], 25)
        rows = first["results"] + second["results"]
        self.assertEqual(len(rows), first["count"])
        self.assertEqual(
            {row["kind"] for row in rows}, {"holding_statement", "meeting_notice", "resolution", "distribution"}
        )
        self.assertTrue(any(row["myBallot"] for row in rows))
        self.assertEqual({row["result"]["carried"] for row in rows if row["result"]}, {True, False})
        summary = self.client.get("/api/v1/publications/summary/").json()
        self.assertGreater(summary["openResolutions"], 0)
        self.assertGreater(summary["dividendsWithoutRecord"], 0)
        self.assertGreaterEqual(
            Notification.objects.filter(user=investor, data__type="publication").count(), first["count"]
        )
        self.assertFalse(PublicationRecipient.objects.filter(identity_source="profile", user_id=None).exists())
        for publication in Publication.objects.all():
            verify_publication(publication.pk)
        events = PublicationEvent.objects.all()
        self.assertEqual(events.filter(kind=PublicationEventKind.CLOSE).count(), 5)
        self.assertGreater(events.filter(kind=PublicationEventKind.PAYMENT).count(), 0)
        recorded = {
            publication.title: PublicationEvent.objects.filter(
                publication=publication, kind=PublicationEventKind.PAYMENT
            ).count()
            for publication in Publication.objects.filter(kind="distribution")
        }
        self.assertEqual(sorted(count > 0 for count in recorded.values()), [False, True, True])
        nothing = PublicationRecipient.objects.filter(publication__kind="distribution", entitlement=0)
        self.assertTrue(nothing.exclude(user_id=None).exists())
        founder = User.objects.get(email=DEMO_OWNER_EMAIL)
        self.client.force_authenticate(founder)
        company = founder.owned_companies.first()
        published = self.client.get("/api/v1/publications/", {"issuer": str(company.uuid)}).json()
        self.assertGreaterEqual(published["count"], 10)

    def check_admin(self):
        self.client.force_login(User.objects.get(email=DEMO_ADMIN_EMAIL))
        for page in ADMIN_PAGES:
            response = self.client.get(page)
            self.assertEqual(response.status_code, 200, page)
        settled = SwapOrder.objects.filter(status=SwapOrderStatus.COMPLETED).latest("completed_at")
        trade = self.client.get(reverse("admin:tokens_swaporder_change", args=[settled.pk]))
        order = self.client.get(reverse("admin:tokens_transferorder_change", args=[settled.sell_order_id]))
        self.assertContains(trade, settled.transaction.tx_hash)
        self.assertContains(order, reverse("admin:tokens_swaporder_change", args=[settled.pk]))
        self.client.logout()

    def check_quiet_jobs(self, shift):
        operator = operator_address()
        ether = self.operator_ether()
        nonce = self.w3.eth.get_transaction_count(operator)
        signed = SignedAttempt.objects.count()
        app.perform_import_paths()
        periodic = list(app.periodic_registry.periodic_tasks.values())
        self.assertGreaterEqual(len(periodic), 30)
        before = rows()
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)
        with ExitStack() as stack:
            for target, behaviour in PRICE_FEED:
                stack.enter_context(patch(target, **behaviour))
            stack.enter_context(self.only_local())
            stack.enter_context(frozen(timezone.now() + shift))
            deferrals = stack.enter_context(captured())
            for item in periodic:
                try:
                    item.task(timestamp=int(time.time()))
                except Exception as exc:
                    self.fail(f"{item.task.name} raised {type(exc).__name__}: {exc}")
            for name, arguments in deferrals.drain():
                app.tasks[name](**arguments)
            self.assertEqual(deferrals.drain(), [])
        found = changes(before, rows())

        self.assertEqual((self.w3.eth.get_transaction_count(operator), SignedAttempt.objects.count()), (nonce, signed))
        self.assertEqual(self.operator_ether().quantity, Web3.from_wei(self.w3.eth.get_balance(operator), "ether"))
        for label, change in found.items():
            self.assertFalse(change["deleted"], label)
            if change["created"]:
                self.assertIn(label, APPENDED_BY_DESIGN, (shift, label, change))
            fields = set(change["fields"])
            if label == "wallets.Holding" and change["fields"].get("quantity") == {ether.pk}:
                fields.remove("quantity")
            self.assertLessEqual(fields, BOOKKEEPING, (shift, label, change))
        latest = RegisterReconciliation.objects.order_by("-created_at")[:5]
        self.assertEqual({record.status for record in latest}, {RegisterReconciliationStatus.MATCHED})
