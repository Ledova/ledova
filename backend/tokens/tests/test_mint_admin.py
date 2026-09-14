from datetime import date
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse

from assets.models import Asset, AssetChainDeployment
from blockchain.models import SignedAttempt
from operators.models import Operator
from tokens.admin._helpers import MintForm
from tokens.models import MintRequest, MintRequestStatus, YieldToken
from tokens.services import mint_service
from tokens.tests.mint_request_fixtures import CHAIN_ID, KEY, MintNode, admitted_signer

User = get_user_model()
RECIPIENT = "0x" + "a" * 40
AUDY_ADDRESS = "0x" + "1" * 40

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def mint_data(amount):
    return {
        "submission_id": str(uuid4()),
        "recipient_address": RECIPIENT,
        "recipient_name": "Alice",
        "amount": amount,
        "deposit_reference": "REF-1",
        "deposit_date": "2026-09-01",
        "notes": "",
    }


def settlement_asset(symbol="AUDY", chain="base", address=AUDY_ADDRESS, decimals=2):
    asset = Asset.objects.create(symbol=symbol, name="Aussie Dollar", asset_type="stablecoin", decimals=decimals)
    AssetChainDeployment.objects.create(asset=asset, chain=chain, contract_address=address, decimals=decimals)
    Operator.get().supported_settlement_assets.add(asset)
    return asset


class MintFormTest(TestCase):
    def test_amount_cleans_to_raw_units_for_the_token_decimals(self):
        form = MintForm(mint_data("100.00"), decimals=2, symbol="AUDY")
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["amount"], 10000)
        self.assertEqual(form.fields["amount"].label, "Amount (AUDY)")

        form = MintForm(mint_data("1.5"), decimals=6, symbol="AUSG")
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["amount"], 1500000)

        self.assertIn("amount", MintForm(mint_data("0.001"), decimals=2, symbol="AUDY").errors)
        bad_address = {**mint_data("1"), "recipient_address": "abc"}
        self.assertIn("recipient_address", MintForm(bad_address, decimals=2, symbol="AUDY").errors)


@override_settings(STORAGES=TEST_STORAGES, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class MintAdminTest(TransactionTestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(email="admin@example.test", password="pw-12345678")
        self.client.force_login(self.admin)
        self.asset = settlement_asset()
        self.yield_token = YieldToken.objects.create(name="Gov Bond", symbol="AUSG", contract_address="0x" + "2" * 40)
        self.node = MintNode()
        admitted_signer()
        for target in (
            "tokens.services.mint_service.get_base_chain_client",
            "tokens.services.base_token_service.get_base_chain_client",
        ):
            patcher = patch(target, return_value=self.node.client)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _mint_request(self, **fields):
        return MintRequest.objects.create(
            settlement_asset=self.asset,
            recipient_address=RECIPIENT,
            recipient_name="Alice",
            amount=10000,
            deposit_reference="REF-1",
            deposit_date=date(2026, 9, 1),
            requested_by=self.admin,
            **fields,
        )

    def _change_url(self, mint_request):
        return reverse("admin:tokens_mintrequest_change", args=[mint_request.pk])

    def test_token_pages_render_with_mint_buttons_and_supply(self):
        cases = (
            ("admin:assets_asset", self.asset, "1,234.56", "AUDY"),
            ("admin:tokens_yieldtoken", self.yield_token, "0.123456", "AUSG"),
        )
        for prefix, token, supply, symbol in cases:
            with self.subTest(token=symbol):
                self.assertContains(self.client.get(reverse(f"{prefix}_changelist")), "+ Mint")
                self.assertEqual(self.client.get(reverse(f"{prefix}_change", args=[token.pk])).status_code, 200)
                page = self.client.get(reverse(f"{prefix}_mint", args=[token.uuid]))
                self.assertContains(page, supply)
                self.assertContains(page, f"Amount ({symbol})")
        self.assertContains(self.client.get(reverse("admin:tokens_yieldtoken_changelist")), "Update NAV")
        self.assertContains(self.client.get(reverse("admin:assets_asset_mint", args=[self.asset.uuid])), AUDY_ADDRESS)

    def test_minting_from_a_token_page_creates_and_executes_a_mint_request(self):
        cases = (
            ("admin:assets_asset_mint", self.asset, "settlement_asset", "100.00", 10000, "100.00 AUDY"),
            ("admin:tokens_yieldtoken_mint", self.yield_token, "yield_token", "1.5", 1500000, "1.500000 AUSG"),
        )
        for route, token, field, amount, raw, display in cases:
            with self.subTest(token=token.symbol):
                response = self.client.post(reverse(route, args=[token.uuid]), mint_data(amount))
                mint_request = MintRequest.objects.get(**{field: token})
                self.assertRedirects(response, self._change_url(mint_request), fetch_redirect_response=False)
                self.assertEqual((mint_request.amount, mint_request.status), (raw, MintRequestStatus.EXECUTED))
                self.assertEqual(mint_request.executed_by, self.admin)
                self.assertEqual(mint_request.transaction.function_args, {"to": RECIPIENT, "amount": raw})
                self.assertEqual(
                    mint_request.operation.intent["to"],
                    (
                        token.chain_deployments.get().contract_address
                        if field == "settlement_asset"
                        else token.contract_address
                    ),
                )
                self.assertEqual(mint_request.operation.current_attempt.tx_hash, mint_request.transaction.tx_hash)
                self.assertContains(
                    self.client.get(self._change_url(mint_request)), f"Successfully minted {display} to Alice"
                )

    def test_a_reverted_mint_can_only_retry_the_attempt_shown_on_its_form(self):
        self.node.receipt_status = 0
        self.client.post(reverse("admin:assets_asset_mint", args=[self.asset.uuid]), mint_data("5.00"))
        mint_request = MintRequest.objects.get()
        self.assertEqual(mint_request.status, MintRequestStatus.FAILED)
        self.assertIn("reverted on chain", mint_request.error_message)
        change = self.client.get(self._change_url(mint_request))
        self.assertContains(change, "Retry")
        self.assertNotContains(change, reverse("admin:tokens_mintrequest_reject", args=[mint_request.uuid]))
        execute_url = reverse("admin:tokens_mintrequest_execute", args=[mint_request.uuid])
        page = self.client.get(execute_url)
        self.assertContains(page, "Retry Mint Request")
        self.assertContains(page, str(mint_request.operation.claim_id))
        retry_data = {"retry_of": str(mint_request.operation.claim_id), "notes": "second try"}
        self.assertEqual(self.client.post(execute_url, retry_data).status_code, 200)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.node.receipt_status = 1
        retried = self.client.post(execute_url, retry_data | {"confirm": "on"})
        self.assertRedirects(retried, self._change_url(mint_request), fetch_redirect_response=False)
        mint_request.refresh_from_db()
        self.assertEqual(mint_request.status, MintRequestStatus.EXECUTED)
        self.assertIn("Execution notes: second try", mint_request.notes)
        self.assertContains(self.client.get(self._change_url(mint_request)), "Successfully minted 5.00 AUDY to Alice")
        self.client.post(execute_url, retry_data | {"confirm": "on"})
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_double_post_recovers_one_mint_but_a_new_form_creates_distinct_work(self):
        url = reverse("admin:assets_asset_mint", args=[self.asset.uuid])
        data = mint_data("2.00")
        self.client.post(url, data)
        self.client.post(url, data)
        self.assertEqual(MintRequest.objects.count(), 1)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.client.post(url, data | {"amount": "3.00"})
        self.assertEqual(MintRequest.objects.get().amount, 200)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.client.post(url, mint_data("2.00"))
        self.assertEqual(MintRequest.objects.count(), 2)
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_lost_acknowledgement_without_receipt_keeps_an_unresolved_recoverable_request(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.client.post(reverse("admin:assets_asset_mint", args=[self.asset.uuid]), mint_data("5.00"))
        mint_request = MintRequest.objects.get()
        self.assertEqual(mint_request.status, MintRequestStatus.EXECUTING)
        page = self.client.get(self._change_url(mint_request))
        self.assertContains(page, "outcome is unresolved")
        self.assertNotContains(page, "Successfully minted")
        execute_url = reverse("admin:tokens_mintrequest_execute", args=[mint_request.uuid])
        self.assertContains(self.client.get(execute_url), "Recover Mint")
        self.node.confirmed = True
        self.client.post(execute_url, {"confirm": "on"})
        mint_request.refresh_from_db()
        self.assertEqual(mint_request.status, MintRequestStatus.EXECUTED)
        self.assertEqual(self.node.broadcasts[0], self.node.broadcasts[1])
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_staff_without_change_permission_is_refused_before_signing(self):
        staff = User.objects.create_user(
            email="reader@example.test", password="synthetic", is_staff=True, is_active=True
        )
        self.client.force_login(staff)
        mint_request = self._mint_request()
        urls = (
            reverse("admin:assets_asset_mint", args=[self.asset.uuid]),
            reverse("admin:tokens_yieldtoken_mint", args=[self.yield_token.uuid]),
            reverse("admin:tokens_mintrequest_execute", args=[mint_request.uuid]),
            reverse("admin:tokens_mintrequest_reject", args=[mint_request.uuid]),
        )
        for url in urls:
            self.assertEqual(self.client.post(url, mint_data("1") | {"confirm": "on", "reason": "No"}).status_code, 403)
        self.assertFalse(SignedAttempt.objects.exists())
        self.node.client.send_raw_transaction.assert_not_called()

    def test_execute_and_reject_guards_and_the_reject_flow(self):
        executed = self._mint_request()
        mint_service.execute(executed, self.admin)
        self.client.get(reverse("admin:tokens_mintrequest_execute", args=[executed.uuid]))
        self.assertContains(
            self.client.get(self._change_url(executed)), "Cannot execute: request status is &#x27;Executed&#x27;"
        )

        pending = self._mint_request()
        self.assertEqual(self.client.get(reverse("admin:tokens_mintrequest_changelist")).status_code, 200)
        self.assertContains(self.client.get(self._change_url(pending)), "Execute Mint")
        reject_url = reverse("admin:tokens_mintrequest_reject", args=[pending.uuid])
        self.assertContains(self.client.get(reject_url), "Reject Mint Request")
        rejected = self.client.post(reject_url, {"reason": "Duplicate"})
        self.assertRedirects(rejected, self._change_url(pending), fetch_redirect_response=False)
        pending.refresh_from_db()
        self.assertEqual(
            (pending.status, pending.rejection_reason, pending.executed_by), ("rejected", "Duplicate", self.admin)
        )

    def test_an_asset_without_a_receiving_chain_deployment_cannot_open_the_mint_page(self):
        Asset.objects.filter(pk=self.asset.pk).update(is_active=False)
        change_url = reverse("admin:assets_asset_change", args=[self.asset.pk])
        response = self.client.get(reverse("admin:assets_asset_mint", args=[self.asset.uuid]))
        self.assertRedirects(response, change_url, fetch_redirect_response=False)
        self.assertContains(self.client.get(change_url), "Cannot mint: AUDY has no active settlement deployment")

        Asset.objects.filter(pk=self.asset.pk).update(is_active=True)
        AssetChainDeployment.objects.filter(asset=self.asset).update(chain="ethereum")
        self.assertRedirects(
            self.client.get(reverse("admin:assets_asset_mint", args=[self.asset.uuid])),
            change_url,
            fetch_redirect_response=False,
        )
        self.assertNotContains(self.client.get(reverse("admin:assets_asset_changelist")), "+ Mint")
        self.assertFalse(MintRequest.objects.exists())

    def test_an_ethereum_receiving_deployment_cannot_offer_or_create_a_base_mint(self):
        operator = Operator.get()
        operator.receiving_wallet_chain = "ethereum"
        operator.save(update_fields=["receiving_wallet_chain"])
        AssetChainDeployment.objects.filter(asset=self.asset).update(chain="ethereum")
        with self.subTest(surface="list"):
            self.assertNotContains(self.client.get(reverse("admin:assets_asset_changelist")), "+ Mint")
        change_url = reverse("admin:assets_asset_change", args=[self.asset.pk])
        mint_url = reverse("admin:assets_asset_mint", args=[self.asset.pk])
        for method in ("get", "post"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(mint_url, mint_data("1") if method == "post" else {})
                self.assertRedirects(response, change_url, fetch_redirect_response=False)
        self.assertFalse(MintRequest.objects.exists())
        self.node.client.send_raw_transaction.assert_not_called()

    def test_an_active_base_token_can_be_minted_before_settlement_acceptance(self):
        Operator.get().supported_settlement_assets.remove(self.asset)
        self.assertContains(self.client.get(reverse("admin:assets_asset_changelist")), "+ Mint")
        response = self.client.post(reverse("admin:assets_asset_mint", args=[self.asset.pk]), mint_data("1"))
        mint_request = MintRequest.objects.get()
        self.assertRedirects(response, self._change_url(mint_request), fetch_redirect_response=False)
        self.assertEqual(mint_request.status, MintRequestStatus.EXECUTED)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_an_inactive_yield_token_cannot_open_the_mint_page(self):
        YieldToken.objects.filter(pk=self.yield_token.pk).update(is_active=False)
        response = self.client.get(reverse("admin:tokens_yieldtoken_mint", args=[self.yield_token.uuid]))
        change_url = reverse("admin:tokens_yieldtoken_change", args=[self.yield_token.pk])
        self.assertRedirects(response, change_url, fetch_redirect_response=False)
        self.assertContains(self.client.get(change_url), "Cannot mint: AUSG is not active")
        self.assertFalse(MintRequest.objects.exists())
