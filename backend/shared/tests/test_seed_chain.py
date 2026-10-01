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
from django.utils import timezone
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.test import APITransactionTestCase

from blockchain.models import SignedAttempt
from blockchain.services.local_signer import admit_local_signer
from integrations.base_chain import get_base_chain_client
from integrations.blockchain import BlockchainClientFactory
from ledova_backend.procrastinate_app import app
from offerings.models import Offering, OfferingStatus, SubscriptionStatus
from operators.services import SEVERITY_DANGER, configuration_health, worklist
from shared.db import use_operator
from shared.seeds.demo import DEMO_INVESTOR_EMAIL, DEMO_OWNER_EMAIL
from shared.seeds.synthetic.chain.deferred import captured
from shared.seeds.synthetic.chain.guard import operator_address
from shared.seeds.synthetic.chain.story import TESTER_WALLETS
from shared.seeds.synthetic.clock import frozen
from shared.services.orphaned_files import orphaned_files
from tokens.models import (
    RegisterReconciliation,
    RegisterReconciliationStatus,
    ShareIssuance,
    ShareToken,
)
from tokens.services import share_token_service
from tokens.services.register_inclusions import waiting_effects
from tokens.tests.test_chain_integration import (
    CHAIN_SETTINGS,
    chain_available,
    reset_chain_client,
)
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
SAFE_ROWS = (
    "Offerings awaiting review",
    "Subscriptions awaiting payment",
    "Subscriptions paid and not allotted",
    "Share issuance requests needing attention",
    "Capital increase requests needing attention",
)
real_connect = socket.socket.connect


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
        fields = defaultdict(int)
        for key in set(then) & set(now):
            for field, value in now[key].items():
                if then[key].get(field) != value:
                    fields[field] += 1
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

    def seed(self):
        output = StringIO()
        with ExitStack() as stack:
            stubs = {target: stack.enter_context(patch(target)) for target in OUTSIDE_WORLD}
            stack.enter_context(self.only_local())
            call_command("seed_demo", stdout=output, password=PASSWORD)
        for target, stub in stubs.items():
            self.assertFalse(stub.called, target)
        return output.getvalue()

    def test_a_fresh_database_gets_a_coherent_chain_layer_that_the_periodic_jobs_leave_alone(self):
        jobs = ProcrastinateJob.objects.count()
        output = self.seed()

        self.assertIn("Chain layer added", output, output)
        self.assertEqual(self.outbound, [])
        self.assertEqual(mail.outbox, [])
        self.assertEqual(ProcrastinateJob.objects.count(), jobs)
        self.check_registers()
        self.check_console()
        self.check_investor_screens()
        self.check_founder_screens()
        self.check_quiet_jobs(timedelta(0))
        self.check_quiet_jobs(timedelta(hours=26))
        self.assertEqual(orphaned_files(moment=timezone.now() + timedelta(days=2)), [])

        signed = SignedAttempt.objects.count()
        tokens = ShareToken.objects.count()
        second = self.seed()

        self.assertIn("Chain layer already present; nothing added.", second)
        self.assertEqual((SignedAttempt.objects.count(), ShareToken.objects.count()), (signed, tokens))

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
            self.assertEqual(shares.count(), len(wallets), token.symbol)
            for holding in shares.select_related("wallet"):
                balance = contract.functions.balanceOf(holding.wallet.address).call()
                self.assertEqual(holding.quantity, Decimal(balance), holding.wallet.address)
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

    def check_quiet_jobs(self, shift):
        operator = operator_address()
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
        for label, change in found.items():
            self.assertFalse(change["deleted"], label)
            if change["created"]:
                self.assertIn(label, APPENDED_BY_DESIGN, (shift, label, change))
            self.assertLessEqual(set(change["fields"]), BOOKKEEPING, (shift, label, change))
        latest = RegisterReconciliation.objects.order_by("-created_at")[:5]
        self.assertEqual({record.status for record in latest}, {RegisterReconciliationStatus.MATCHED})
