import ipaddress
import socket
from contextlib import ExitStack
from io import StringIO
from unittest.mock import patch
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.services.local_signer import admit_local_signer
from integrations.base_chain import get_base_chain_client
from integrations.blockchain import BlockchainClientFactory
from offerings.models import Offering, Subscription
from shared.db import use_operator
from shared.seeds.demo import DEMO_INVESTOR_EMAIL
from shared.seeds.synthetic.chain.approvals import TREASURY_UNSUPPORTED
from shared.seeds.synthetic.chain.guard import operator_address
from shared.seeds.synthetic.plan import MINIMUM_INVESTORS
from shareholders.models import Publication, PublicationEvent
from tokens.models import (
    CapitalIncreaseRequest,
    MintRequest,
    PauseChange,
    RegisterDeployment,
    RegisterEntry,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
    SwapOrder,
    TokenDeployment,
    TransferOrder,
)
from tokens.tests.test_chain_integration import (
    CHAIN_SETTINGS,
    chain_available,
    isolate_chain,
    reset_chain_client,
)
from wallets.models import Wallet, WalletPossessionProof
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletNomination,
    WhitelistApproval,
    WhitelistChange,
)

User = get_user_model()
PASSWORD = "pw-12345678"
OUTSIDE_WORLD = (
    "integrations.expo_push.client.ExpoPushClient.send_batch",
    "integrations.sendgrid_email.client.SendGridClient.send_email",
    "companies.services.registry.lookup_company",
    "users.services.identity.get_kyc_provider",
    "integrations.llm_extract.client.LlmExtractClient.extract",
)
EFFECT_MODELS = (
    OutgoingOperation,
    SignedAttempt,
    TokenDeployment,
    RegisterDeployment,
    CapitalIncreaseRequest,
    PauseChange,
    ShareIssuance,
    ShareIssuanceRequest,
    RegisterEntry,
    MintRequest,
    Offering,
    Subscription,
    SwapOrder,
    TransferOrder,
    Publication,
    PublicationEvent,
    WalletPossessionProof,
    CompanyWalletNomination,
    CompanyWalletInstruction,
    WhitelistChange,
    WhitelistApproval,
)
real_connect = socket.socket.connect


@chain_available
@override_settings(DEBUG=True, **CHAIN_SETTINGS)
class ChainLayerTest(APITransactionTestCase):
    def setUp(self):
        super().setUp()
        reset_chain_client()
        BlockchainClientFactory._clients.clear()
        self.addCleanup(BlockchainClientFactory._clients.clear)
        self.w3 = get_base_chain_client().w3
        self.assertEqual(self.w3.eth.chain_id, 31337)
        isolate_chain(self, self.w3)
        call_command("sync_monitoring_rules", stdout=StringIO())
        with use_operator():
            admit_local_signer()
        self.outbound = []
        endpoint = urlsplit(settings.BLOCKCHAIN_RPC_URL)
        self.node_addresses = {
            result[4][:2]
            for result in socket.getaddrinfo(endpoint.hostname, endpoint.port or 80, type=socket.SOCK_STREAM)
        }

    def only_local(self):
        def connect(sock, address):
            host = address[0] if isinstance(address, tuple) else address
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local = host == "localhost"
            if not local and address[:2] not in self.node_addresses:
                self.outbound.append(host)
                raise ConnectionRefusedError("The seed test allows only its owned local chain endpoint.")
            return real_connect(sock, address)

        return patch.object(socket.socket, "connect", connect)

    def seed(self):
        output = StringIO()
        with ExitStack() as stack:
            stubs = {target: stack.enter_context(patch(target)) for target in OUTSIDE_WORLD}
            market = stack.enter_context(patch("shared.seeds.synthetic.market.layer.seed_market"))
            stack.enter_context(self.only_local())
            call_command("seed_demo", stdout=output, password=PASSWORD, investors=MINIMUM_INVESTORS)
        for target, stub in stubs.items():
            self.assertFalse(stub.called, target)
        market.assert_not_called()
        return output.getvalue()

    def assert_refused_without_chain_effects(self, output, before):
        self.assertIn(f"Chain layer skipped: {TREASURY_UNSUPPORTED}\n", output)
        self.assertNotIn("Chain layer added", output)
        self.assertNotIn("Market layer added", output)
        operator = operator_address()
        self.assertEqual(
            (self.w3.eth.block_number, self.w3.eth.get_transaction_count(operator), self.w3.eth.get_balance(operator)),
            before,
        )
        for model in EFFECT_MODELS:
            self.assertEqual(model.objects.count(), 0, model._meta.label)
        self.assertTrue(ShareToken.objects.exists())
        self.assertEqual(set(ShareToken.objects.values_list("status", flat=True)), {"draft"})
        self.assertFalse(ShareToken.objects.exclude(contract_address=None).exists())
        self.assertEqual(self.outbound, [])
        self.assertEqual(mail.outbox, [])

    def test_no_key_treasury_refuses_the_fresh_chain_and_market_layers_without_partial_records_or_nonce(self):
        operator = operator_address()
        before = (
            self.w3.eth.block_number,
            self.w3.eth.get_transaction_count(operator),
            self.w3.eth.get_balance(operator),
        )
        signer = SigningAccount.objects.values("uuid", "next_nonce").get()
        output = self.seed()
        self.assert_refused_without_chain_effects(output, before)
        self.assertEqual(SigningAccount.objects.values("uuid", "next_nonce").get(), signer)
        population = {model: model.objects.count() for model in (User, Wallet, ShareToken)}
        second = self.seed()
        self.assertIn("Synthetic population already present; nothing added.", second)
        self.assert_refused_without_chain_effects(second, before)
        self.assertEqual({model: model.objects.count() for model in population}, population)
        self.assertEqual(SigningAccount.objects.values("uuid", "next_nonce").get(), signer)

    def test_refused_chain_layer_preserves_own_wallet_privacy_without_inventing_share_holdings(self):
        self.assertIn(f"Chain layer skipped: {TREASURY_UNSUPPORTED}\n", self.seed())
        investor = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        own = Wallet.objects.filter(user_account__user_profile__user=investor, chain="base")
        foreign = Wallet.objects.exclude(user_account__user_profile__user=investor).filter(chain="base").first()
        self.assertTrue(own.exists())
        self.assertIsNotNone(foreign)
        self.client.force_authenticate(investor)
        response = self.client.get("/api/wallets/", {"chain": "base"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual({row["uuid"] for row in response.json()["results"]}, {str(wallet.pk) for wallet in own})
        forbidden = self.client.get(f"/api/wallets/{foreign.pk}/holdings/")
        self.assertEqual(forbidden.status_code, 404, forbidden.content)
        for wallet in own:
            response = self.client.get(f"/api/wallets/{wallet.pk}/holdings/")
            self.assertEqual(response.status_code, 200, response.content)
            payload = response.json()
            holdings = payload["results"] if isinstance(payload, dict) else payload
            self.assertTrue(all(not holding.get("shareClass") for holding in holdings))
