from decimal import Decimal
from io import StringIO
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.test import TestCase, TransactionTestCase, override_settings
from web3 import Web3

from assets.models import Asset, AssetChainDeployment, AssetType
from assets.services.identity import quarantine_unknown_token
from shared.tests.tenants import make_tenant
from tokens.models import (
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution, share_token_service
from tokens.services.share_token_service import SHARE_ASSET_CHAIN
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY, admit, install_issuance
from wallets.models import Holding
from whitelist.models import WhitelistEntry, WhitelistStatus

CHAIN_CLIENT = "tokens.services.share_token_service.get_base_chain_client"
WHITELISTED = "tokens.services.share_token_service.is_recipient_whitelisted"
SUPPLY = "tokens.services.share_token_service.share_supply"
CREATED = "0x" + "c0ffee" + "0" * 34
ELSEWHERE = "0x" + "dead" + "0" * 36
SIGNER = "0x" + "e" * 40
RECEIPT = {"blockNumber": 9, "blockHash": bytes.fromhex("ab" * 32), "gasUsed": 1_000_000}


def factory(existing):
    contract = Mock()
    contract.functions.getTokenByIdentifier.return_value.call.return_value = existing
    return contract


@override_settings(SHARE_TOKEN_FACTORY_ADDRESS="0x" + "f" * 40, BLOCKCHAIN_OPERATOR_KEY="0xkey")
class ShareAssetBridgeTest(TestCase):
    def setUp(self):
        self.chain = patch(CHAIN_CLIENT).start().return_value
        self.chain.load_contract.return_value.functions.authorizedShares.return_value.call.return_value = 1000
        self.addCleanup(patch.stopall)
        self.tenant = make_tenant("owner")
        self.token = self.tenant.token
        self.token.mark_deploying()

    def _bridge(self, token=None, address=CREATED):
        self.chain.load_contract.return_value = factory(address)
        share_token_service.bridge_share_asset(token or self.token, address)

    def _shares(self):
        return Asset.objects.filter(asset_type=AssetType.TOKENIZED_SECURITY.value).exclude(symbol__startswith="TENANT")

    def test_bridging_writes_a_verified_asset_at_the_address_the_factory_reported(self):
        self._bridge()

        asset = self._shares().get()
        self.assertEqual((asset.symbol, asset.decimals, asset.is_verified), ("DRF", 0, True))
        self.assertEqual(asset.name, f"{self.tenant.company.name} {self.token.name}")
        self.assertIsNone(asset.current_price)
        deployment = asset.chain_deployments.get()
        self.assertEqual((deployment.chain, deployment.contract_address), (SHARE_ASSET_CHAIN, CREATED))

    def test_repeated_bridge_leaves_one_asset_and_deployment(self):
        self._bridge()
        self.token.refresh_from_db()
        self._bridge()

        self.assertEqual(self._shares().count(), 1)
        self.assertEqual(AssetChainDeployment.objects.filter(contract_address=CREATED).count(), 1)

    def test_bridging_an_already_registered_contract_writes_no_second_asset(self):
        self._bridge()
        self.token.refresh_from_db()

        self._bridge()

        self.assertEqual(self._shares().count(), 1)
        self.assertEqual(AssetChainDeployment.objects.filter(contract_address=CREATED).count(), 1)

    def test_an_address_the_factory_does_not_hold_leaves_the_quarantined_row_unverified(self):
        quarantined = quarantine_unknown_token(
            chain=SHARE_ASSET_CHAIN, contract_address=ELSEWHERE, symbol="DRF", decimals=18
        )

        with self.assertLogs("tokens.services.share_token_service", level="WARNING") as logs:
            self.chain.load_contract.return_value = factory(CREATED)
            share_token_service.bridge_share_asset(self.token, ELSEWHERE)

        self.assertIn("is not the address the factory holds", "\n".join(logs.output))
        quarantined.refresh_from_db()
        self.assertFalse(quarantined.is_verified)
        self.assertEqual((quarantined.asset_type, quarantined.decimals), ("erc20_token", 18))
        self.assertEqual(self._shares().count(), 0)
        self.token.refresh_from_db()
        self.assertIsNone(self.token.contract_address)

    def test_two_companies_sharing_a_symbol_get_two_distinct_assets(self):
        self._bridge()
        other = make_tenant("rival")
        rival_token = other.token
        rival_token.mark_deploying()

        self._bridge(rival_token, ELSEWHERE)

        symbols = sorted(self._shares().values_list("symbol", flat=True))
        self.assertEqual(symbols, ["DRF", f"DRF.{other.company.acn}"])
        self.assertEqual(
            Asset.objects.get(symbol=f"DRF.{other.company.acn}").chain_deployments.get().contract_address, ELSEWHERE
        )


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class IssuanceSeedsTheHoldingTest(TransactionTestCase):
    def setUp(self):
        install_issuance(self)
        self.wallet = self.tenant.wallet
        self.asset = Asset.objects.create(
            symbol="DEP",
            name="Owner shares",
            asset_type=AssetType.TOKENIZED_SECURITY.value,
            decimals=0,
            is_verified=True,
        )
        AssetChainDeployment.objects.create(
            asset=self.asset, chain=SHARE_ASSET_CHAIN, contract_address=self.token.contract_address, decimals=0
        )

    def _request(self, recipient):
        request = ShareIssuanceRequest.objects.create(
            token=self.token, recipient_address=recipient, amount=25, reason="Allotment"
        )
        ShareIssuanceRequest.objects.filter(pk=request.pk).update(status=RequestStatus.APPROVED)
        request.refresh_from_db()
        return request

    def _balance(self, value):
        return patch.object(share_token_service, "get_token_balance", return_value=value)

    def test_an_allotment_to_a_whitelisted_investor_wallet_writes_the_holding(self):
        WhitelistEntry.objects.create(wallet=self.wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        request = self._request(self.wallet.address)

        with self._balance(25):
            issuance_execution.recover(admit(request, self.actor).pk)

        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.EXECUTED)
        holding = Holding.objects.get(wallet=self.wallet, asset=self.asset)
        self.assertEqual(holding.quantity, Decimal("25"))
        self.assertEqual(holding.snapshots.get().quantity, Decimal("25"))
        self.assertIsNone(holding.market_value)

    def test_a_treasury_entry_with_no_wallet_is_skipped_and_raises_nothing(self):
        treasury = Web3.to_checksum_address("0x" + "7" * 40)
        WhitelistEntry.objects.create(
            address=treasury, label="Treasury", status=WhitelistStatus.ACTIVE, is_whitelisted=True
        )
        request = self._request(treasury)

        with self._balance(25):
            issuance_execution.recover(admit(request, self.actor).pk)

        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.EXECUTED)
        self.assertFalse(Holding.objects.filter(asset=self.asset).exists())
        self.assertEqual(ShareIssuance.objects.get(token=self.token).status, IssuanceStatus.COMPLETED)

    def test_a_bookkeeping_failure_never_fails_an_issuance_whose_mint_already_mined(self):
        WhitelistEntry.objects.create(wallet=self.wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        request = self._request(self.wallet.address)

        with patch("wallets.services.holdings.sync_holding", side_effect=RuntimeError("database gone")) as sync:
            with self.assertLogs("tokens.services.share_token_service", level="ERROR") as logs:
                result = issuance_execution.recover(admit(request, self.actor).pk)

        sync.assert_called_once()
        self.assertIn("Could not record the holding", "\n".join(logs.output))
        self.assertEqual(result["tx_hash"], ShareIssuance.objects.get().tx_hash)
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.EXECUTED)
        self.assertEqual(ShareIssuance.objects.get(token=self.token).status, IssuanceStatus.COMPLETED)
        self.assertFalse(Holding.objects.filter(asset=self.asset).exists())

    def test_a_missing_bridged_asset_is_logged_and_leaves_the_issuance_executed(self):
        AssetChainDeployment.objects.filter(asset=self.asset).delete()
        WhitelistEntry.objects.create(wallet=self.wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        request = self._request(self.wallet.address)

        with self.assertLogs("tokens.services.share_token_service", level="WARNING") as logs:
            issuance_execution.recover(admit(request, self.actor).pk)

        self.assertIn("has no asset on base", "\n".join(logs.output))
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.EXECUTED)
        self.assertFalse(Holding.objects.filter(asset=self.asset).exists())


@override_settings(SHARE_TOKEN_FACTORY_ADDRESS="0x" + "f" * 40, BLOCKCHAIN_OPERATOR_KEY="0xkey")
class BridgeShareAssetsCommandTest(TestCase):
    def setUp(self):
        self.chain = patch(CHAIN_CLIENT).start().return_value
        self.addCleanup(patch.stopall)
        self.tenant = make_tenant("owner")
        self.token = self.tenant.deployed_token
        self.chain.load_contract.return_value.functions.getTokenByIdentifier.return_value.call.return_value = (
            self.token.contract_address
        )

    def _run(self, **options):
        output = StringIO()
        call_command("bridge_share_assets", stdout=output, **options)
        return output.getvalue()

    def test_the_dry_run_writes_nothing(self):
        output = self._run(dry_run=True)

        self.assertIn(f"would bridge {self.tenant.company.name} DEP", output)
        self.assertFalse(AssetChainDeployment.objects.filter(contract_address=self.token.contract_address).exists())

    def test_the_backfill_is_idempotent(self):
        self._run()
        self._run()

        deployment = AssetChainDeployment.objects.get(contract_address=self.token.contract_address)
        self.assertEqual(deployment.asset.symbol, "DEP")
        self.assertTrue(deployment.asset.is_verified)
        self.assertEqual(deployment.asset.asset_type, AssetType.TOKENIZED_SECURITY.value)
