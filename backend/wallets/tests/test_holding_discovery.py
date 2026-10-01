from decimal import Decimal
from unittest.mock import call, patch

from django.test import TestCase

from assets.models import Asset, AssetChainDeployment
from operators.models import Operator
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken, ShareTokenStatus
from tokens.services import share_token_service
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Holding, Wallet
from wallets.services.holdings import discover_holdings
from wallets.services.sync import _sync_holdings_from_blockchain
from whitelist.models import WhitelistApproval, WhitelistEntry, WhitelistStatus

REGISTRY = "0x" + "ab" * 20


class TheWalletSyncFindsSharesItHasNoHoldingForTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("discovery")
        self.issuer = make_tenant("discovery-issuer")
        self.wallet = self.tenant.wallet
        Holding.objects.filter(wallet=self.wallet).delete()
        self.token = self.issuer.deployed_token
        self.asset = self.share_asset(self.token, "DSC")
        self.entry = WhitelistEntry.objects.create(wallet=self.wallet)
        self.approval = WhitelistApproval.objects.create(
            entry=self.entry, company=self.issuer.company, registry_address=REGISTRY, status=WhitelistStatus.ACTIVE
        )
        self.addCleanup(patch.stopall)
        patch("tokens.services.share_token_service.get_base_chain_client").start()
        self.balance = patch.object(share_token_service, "get_token_balance", return_value=7).start()

    def share_asset(self, token, symbol):
        asset = Asset.objects.create(
            symbol=symbol, name=f"{symbol} shares", asset_type="tokenized_security", decimals=0, is_verified=True
        )
        AssetChainDeployment.objects.create(
            asset=asset, chain="base", contract_address=token.contract_address, decimals=0
        )
        return asset

    def held(self):
        return dict(Holding.objects.filter(wallet=self.wallet).values_list("asset__symbol", "quantity"))

    def test_a_class_of_a_company_that_approved_the_wallet_and_that_it_holds_gets_a_holding(self):
        self.assertEqual(_sync_holdings_from_blockchain(self.wallet), (1, 0))

        self.assertEqual(self.held(), {"DSC": Decimal(7)})
        self.balance.assert_called_once_with(self.token.contract_address, self.wallet.address)

    def test_a_class_it_holds_none_of_gets_no_holding(self):
        self.balance.return_value = 0

        self.assertEqual(discover_holdings(self.wallet), [])

        self.assertEqual(self.held(), {})

    def test_a_class_of_a_company_that_never_approved_the_wallet_is_never_read(self):
        stranger = make_tenant("discovery-stranger")
        self.share_asset(stranger.deployed_token, "STR")

        discover_holdings(self.wallet)

        self.assertEqual(self.balance.call_args_list, [call(self.token.contract_address, self.wallet.address)])
        self.assertEqual(self.held(), {"DSC": Decimal(7)})

    def test_a_removed_approval_still_finds_the_shares_the_wallet_kept(self):
        WhitelistApproval.objects.filter(pk=self.approval.pk).update(status=WhitelistStatus.REMOVED)

        discover_holdings(self.wallet)

        self.assertEqual(self.held(), {"DSC": Decimal(7)})

    def test_a_class_the_chain_cannot_answer_writes_nothing_and_does_not_fail_the_sync(self):
        self.balance.side_effect = RuntimeError("no code at the address")

        self.assertEqual(_sync_holdings_from_blockchain(self.wallet), (0, 0))

        self.assertEqual(self.held(), {})

    def test_a_class_already_held_is_refreshed_once_and_not_found_again(self):
        Holding.objects.create(wallet=self.wallet, asset=self.asset, quantity=Decimal(3))

        self.assertEqual(_sync_holdings_from_blockchain(self.wallet), (1, 0))

        self.assertEqual(self.balance.call_count, 1)
        self.assertEqual(self.held(), {"DSC": Decimal(7)})

    def test_a_class_that_is_not_deployed_or_has_no_verified_asset_is_left_alone(self):
        self.token.status = ShareTokenStatus.PAUSED
        self.token.save(update_fields=["status"])
        second = ShareToken.objects.create(
            company=self.issuer.company,
            name="Unverified shares",
            symbol="UNV",
            total_supply="1000",
            status=ShareTokenStatus.DEPLOYED,
            contract_address="0x" + "c2" * 20,
            chain="base",
        )
        Asset.objects.filter(pk=self.share_asset(second, "UNV").pk).update(is_verified=False)

        self.assertEqual(discover_holdings(self.wallet), [])

        self.balance.assert_not_called()


class TheWalletSyncFindsTheSettlementAssetItHasNoHoldingForTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("settlement-discovery")
        self.wallet = self.tenant.wallet
        Holding.objects.filter(wallet=self.wallet).delete()
        self.stablecoin = self.tenant.refs.stablecoin
        Operator.get().supported_settlement_assets.set([self.stablecoin])
        self.addCleanup(patch.stopall)
        self.chain = patch("wallets.services.chain.get_blockchain_client").start().return_value
        self.chain.get_token_balance.return_value = Decimal("12.5")

    def held(self, wallet=None):
        return dict(Holding.objects.filter(wallet=wallet or self.wallet).values_list("asset__symbol", "quantity"))

    def test_a_wallet_that_holds_the_settlement_asset_without_a_holding_gets_one(self):
        self.assertEqual(_sync_holdings_from_blockchain(self.wallet), (1, 0))

        self.assertEqual(self.held(), {self.stablecoin.symbol: Decimal("12.5")})
        self.chain.get_token_balance.assert_called_once_with(
            address=self.wallet.address,
            contract_address=self.stablecoin.get_deployment_for_chain("base").contract_address,
            decimals=2,
        )

    def test_a_wallet_that_holds_none_of_it_gets_no_holding(self):
        self.chain.get_token_balance.return_value = Decimal("0")

        self.assertEqual(discover_holdings(self.wallet), [])

        self.assertEqual(self.held(), {})

    def test_a_balance_the_chain_cannot_give_writes_nothing_and_does_not_fail_the_sync(self):
        self.chain.get_token_balance.side_effect = RuntimeError("the node is gone")

        self.assertEqual(_sync_holdings_from_blockchain(self.wallet), (0, 0))

        self.assertEqual(self.held(), {})

    def test_an_operator_that_settles_in_more_than_one_asset_has_no_settlement_asset_to_look_for(self):
        second = Asset.objects.create(
            symbol="TUS2", name="Second dollar", asset_type="stablecoin", decimals=2, is_verified=True
        )
        AssetChainDeployment.objects.create(asset=second, chain="base", contract_address="0x" + "6" * 40, decimals=2)
        Operator.get().supported_settlement_assets.add(second)

        self.assertEqual(discover_holdings(self.wallet), [])

        self.chain.get_token_balance.assert_not_called()

    def test_an_unverified_settlement_asset_is_not_looked_for(self):
        Asset.objects.filter(pk=self.stablecoin.pk).update(is_verified=False)

        self.assertEqual(discover_holdings(self.wallet), [])

        self.chain.get_token_balance.assert_not_called()

    def test_a_wallet_on_a_chain_without_the_settlement_asset_is_not_read(self):
        elsewhere = Wallet.objects.create(
            user_account=self.tenant.account,
            address=self.wallet.address,
            chain="ethereum",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )

        self.assertEqual(discover_holdings(elsewhere), [])

        self.chain.get_token_balance.assert_not_called()
        self.assertEqual(self.held(elsewhere), {})

    def test_a_settlement_asset_already_held_is_refreshed_once_and_not_found_again(self):
        Holding.objects.create(wallet=self.wallet, asset=self.stablecoin, quantity=Decimal("3"))

        self.assertEqual(_sync_holdings_from_blockchain(self.wallet), (1, 0))

        self.assertEqual(self.chain.get_token_balance.call_count, 1)
        self.assertEqual(self.held(), {self.stablecoin.symbol: Decimal("12.5")})
