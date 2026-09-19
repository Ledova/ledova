from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.services.chain import fetch_chain_balance
from wallets.tests.test_wallet_finality import WalletFinalityFixture


class DisabledNativeSettlementChecks(WalletFinalityFixture):
    def test_unreadable_native_deployment_cannot_release_the_final_failure_hold(self):
        self.observer.get_transaction_receipt.return_value["status"] = 0
        self.finish()
        with use_operator():
            deployment = AssetChainDeployment.objects.get(asset=self.native, chain="base")
        for changed in ({"is_active": False}, {"contract_address": "0x" + "dd" * 20}, {"decimals": 6}):
            with self.subTest(changed=changed):
                with use_operator():
                    AssetChainDeployment.objects.filter(pk=deployment.pk).update(**changed)
                with patch("wallets.services.holdings.fetch_chain_balance", wraps=fetch_chain_balance):
                    self.assertFalse(self.repair())
                self.assertEqual(self.quantity(), Decimal("7.999958"))
                self.assertIsNotNone(self.transactions()[0]["balance_reconciliation_token"])
                with use_operator():
                    AssetChainDeployment.objects.filter(pk=deployment.pk).update(
                        is_active=True, contract_address=None, decimals=18
                    )
        with use_operator():
            Asset.objects.filter(pk=self.native.pk).update(is_active=False)
        with patch("wallets.services.holdings.fetch_chain_balance", wraps=fetch_chain_balance):
            self.assertFalse(self.repair())
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        with use_operator():
            Asset.objects.filter(pk=self.native.pk).update(is_active=True)
        self.balance = Decimal("9.999958")
        self.assertTrue(self.repair())
        self.assertEqual(self.quantity(), self.balance)


class DisabledNativeSettlementTest(DisabledNativeSettlementChecks, APITransactionTestCase):
    pass


class ScopedDisabledNativeSettlementTest(
    RunsOnTheScopedConnection, DisabledNativeSettlementChecks, APITransactionTestCase
):
    pass
