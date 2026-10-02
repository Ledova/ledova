from decimal import Decimal

from django.contrib.admin.templatetags.admin_list import results
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils.html import strip_tags
from rest_framework.test import APITestCase

from assets.models import Asset
from shared.tests.tenants import make_tenant
from wallets.models import Holding, Transaction
from wallets.tests.share_symbol_fixtures import two_ordinary_classes
from wallets.tests.test_admin_pages import TEST_STORAGES


def holdings_and_transfers(test, holder):
    test.first = make_tenant("symbol-first")
    test.second = make_tenant("symbol-second")
    (test.first_token, test.first_asset), (test.second_token, test.second_asset) = two_ordinary_classes(
        test.first.company, test.second.company
    )
    test.eth, _ = Asset.objects.get_or_create(
        symbol="ETH", defaults={"name": "Ether", "asset_type": "native_crypto", "is_verified": True}
    )
    for number, (asset, quantity) in enumerate(((test.first_asset, 120), (test.second_asset, 30), (test.eth, 2)), 1):
        if asset != test.eth:
            Holding.objects.create(wallet=holder.wallet, asset=asset, quantity=Decimal(quantity))
        Transaction.objects.create(
            wallet=holder.wallet,
            asset=asset,
            tx_hash="0x" + f"{number:064x}",
            chain="base",
            from_address="0x" + "3" * 40,
            to_address=holder.wallet.address,
            amount=Decimal(quantity),
        )


class EachShareClassKeepsItsOwnSymbolTest(APITestCase):
    def setUp(self):
        self.holder = make_tenant("symbol-holder")
        holdings_and_transfers(self, self.holder)
        self.client.force_authenticate(self.holder.user)
        self.suffixed = f"ORD.{self.second.company.acn}"

    def share_classes(self):
        return {
            "ORD": {
                "uuid": str(self.first_token.uuid),
                "name": "Ordinary Shares",
                "symbol": "ORD",
                "companyName": "symbol-first Pty Ltd",
            },
            self.suffixed: {
                "uuid": str(self.second_token.uuid),
                "name": "Ordinary Shares",
                "symbol": "ORD",
                "companyName": "symbol-second Pty Ltd",
            },
        }

    def test_the_bridge_suffixes_the_second_asset_symbol_with_its_company_number(self):
        self.assertEqual((self.first_asset.symbol, self.second_asset.symbol), ("ORD", self.suffixed))

    def test_each_holding_names_its_class_symbol_and_company_beside_the_unique_asset_symbol(self):
        response = self.client.get(f"/api/wallets/{self.holder.wallet.uuid}/holdings/")

        self.assertEqual(response.status_code, 200, response.content)
        rows = {row["assetSymbol"]: row["shareClass"] for row in response.json()}
        self.assertEqual({symbol: rows[symbol] for symbol in ("ORD", self.suffixed)}, self.share_classes())
        self.assertIsNone(rows["TENANT"])

    def test_each_transfer_in_activity_names_its_class_symbol_and_company_and_crypto_names_none(self):
        response = self.client.get("/api/transactions/", {"wallet": str(self.holder.wallet.uuid)})

        self.assertEqual(response.status_code, 200, response.content)
        rows = {row["assetSymbol"]: row["shareClass"] for row in response.json()["results"]}
        self.assertEqual({symbol: rows[symbol] for symbol in ("ORD", self.suffixed)}, self.share_classes())
        self.assertIsNone(rows["ETH"])
        self.assertIsNone(rows["TENANT"])


@override_settings(STORAGES=TEST_STORAGES)
class StaffListsShowTheClassSymbolTest(TestCase):
    def setUp(self):
        self.holder = make_tenant("symbol-admin", superuser=True)
        holdings_and_transfers(self, self.holder)
        self.client.force_login(self.holder.user)

    def cells(self, model_name):
        response = self.client.get(reverse(f"admin:wallets_{model_name}_changelist"))
        self.assertEqual(response.status_code, 200)
        return {strip_tags(cell) for row in results(response.context["cl"]) for cell in row}

    def test_holdings_and_transactions_show_each_class_symbol_with_its_company_and_crypto_as_before(self):
        classes = {"ORD (symbol-first Pty Ltd)", "ORD (symbol-second Pty Ltd)"}
        suffixed = f"ORD.{self.second.company.acn}"
        for model_name, crypto in (("holding", "TENANT"), ("transaction", str(self.eth))):
            with self.subTest(model_name=model_name):
                cells = self.cells(model_name)

                self.assertLessEqual({*classes, crypto}, cells)
                self.assertEqual([cell for cell in cells if suffixed in cell], [])
