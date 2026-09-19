from decimal import Decimal
from unittest.mock import Mock, patch

from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from shared.db import acting_for, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Holding
from wallets.services.chain import fetch_chain_balance
from wallets.services.holdings import sync_holding
from wallets.tests.test_wallet_finality import WalletFinalityFixture

CONTRACT = "0x" + "77" * 20


class TokenFinalityFixture(WalletFinalityFixture):
    def signed(self, **overrides):
        if not hasattr(self, "token"):
            with use_operator():
                self.token = Asset.objects.create(
                    symbol="FINAL", name="Finality token", asset_type="erc20_token", is_verified=True
                )
                self.deployment = AssetChainDeployment.objects.create(
                    asset=self.token, chain="base", contract_address=CONTRACT, decimals=6
                )
                self.token_holding = Holding.objects.create(wallet=self.wallet, asset=self.token, quantity=100)
        data = "0xa9059cbb" + self.recipient[2:].lower().zfill(64) + f"{2_000_000:064x}"
        return super().signed(**{"to": CONTRACT, "value": 0, "data": data, "gas": 100000, **overrides})

    def read_balance(self, wallet, asset):
        super().read_balance(wallet, asset)
        return self.balance.get(asset.pk) if isinstance(self.balance, dict) else self.balance

    def quantities(self):
        with use_operator():
            return (
                Holding.objects.get(pk=self.token_holding.pk).quantity,
                Holding.objects.get(pk=self.holding.pk).quantity,
            )


class TokenFinalityChecks(TokenFinalityFixture):
    def test_pending_token_amount_and_native_fee_stay_capped_independently(self):
        self.balance = {self.token.pk: Decimal("100"), self.native.pk: Decimal("10")}
        with acting_for(self.tenant.user.pk):
            self.assertIsNone(sync_holding(self.wallet, self.token))
            self.assertIsNone(sync_holding(self.wallet, self.native))
        self.assertEqual(self.quantities(), (Decimal("98"), Decimal("9.9998")))
        self.balance[self.token.pk] = Decimal("97")
        with acting_for(self.tenant.user.pk):
            self.assertIsNone(sync_holding(self.wallet, self.token))
        self.assertEqual(self.quantities(), (Decimal("97"), Decimal("9.9998")))

    def test_final_token_failure_never_refunds_the_fee_without_a_balance_read(self):
        self.observer.get_transaction_receipt.return_value["status"] = 0
        self.assertEqual(self.finish()["status"], "failed")
        self.assertEqual(self.quantities(), (Decimal("98"), Decimal("9.9998")))
        self.balance = {self.token.pk: Decimal("100"), self.native.pk: None}
        self.assertFalse(self.repair())
        self.assertEqual(self.quantities(), (Decimal("100"), Decimal("9.9998")))
        self.assertIsNotNone(self.transactions()[0]["balance_reconciliation_token"])
        self.balance[self.native.pk] = Decimal("9.999958")
        self.assertTrue(self.repair())
        self.assertEqual(self.quantities(), (Decimal("100"), Decimal("9.999958")))
        self.notification.assert_called_once()

    def test_disabled_native_reads_keep_a_completed_token_repair_pending(self):
        self.assertEqual(self.finish()["status"], "confirmed")
        with use_operator():
            native = AssetChainDeployment.objects.get(asset=self.native, chain="base")
            AssetChainDeployment.objects.filter(pk=native.pk).update(is_active=False)
        self.balance = {self.token.pk: Decimal("98"), self.native.pk: None}
        self.assertFalse(self.repair())
        self.assertEqual(self.quantities(), (Decimal("98"), Decimal("9.9998")))
        self.assertIsNotNone(self.transactions()[0]["balance_reconciliation_token"])

    def test_changed_contract_or_units_cannot_supply_a_repair_for_the_recorded_asset(self):
        self.finish()
        with patch("wallets.services.chain.get_blockchain_client") as provider:
            for changed in ({"contract_address": "0x" + "88" * 20}, {"decimals": 18}):
                with self.subTest(changed=changed), use_operator():
                    AssetChainDeployment.objects.filter(pk=self.deployment.pk).update(**changed)
                    self.assertIsNone(fetch_chain_balance(self.wallet, self.token))
                    AssetChainDeployment.objects.filter(pk=self.deployment.pk).update(
                        contract_address=CONTRACT, decimals=6
                    )
            provider.assert_not_called()

    def test_network_drift_during_balance_read_keeps_the_repair_unknown(self):
        self.finish()
        with patch("wallets.services.chain.get_blockchain_client") as factory:
            client = factory.return_value
            client.assert_expected_chain = Mock(side_effect=[84532, 11155111])
            client.get_token_balance.return_value = Decimal("100")
            with acting_for(self.tenant.user.pk):
                self.assertIsNone(fetch_chain_balance(self.wallet, self.token))
            client.get_token_balance.assert_called_once()
        self.assertEqual(self.quantities(), (Decimal("98"), Decimal("9.9998")))

    def test_withdrawn_finality_policy_keeps_ordinary_sync_and_repair_capped(self):
        self.finish()
        self.balance = {self.token.pk: Decimal("100"), self.native.pk: Decimal("10")}
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES={}):
            self.assertFalse(self.repair())
            with acting_for(self.tenant.user.pk):
                self.assertIsNone(sync_holding(self.wallet, self.token))
                self.assertIsNone(sync_holding(self.wallet, self.native))
        self.assertEqual(self.quantities(), (Decimal("98"), Decimal("9.9998")))
        self.assertTrue(self.repair())


class TokenFinalityTest(TokenFinalityChecks, APITransactionTestCase):
    pass


class ScopedTokenFinalityTest(RunsOnTheScopedConnection, TokenFinalityChecks, APITransactionTestCase):
    pass
