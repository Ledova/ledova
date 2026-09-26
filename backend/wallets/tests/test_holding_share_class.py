from decimal import Decimal

from django.db import connections
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from assets.models import Asset, AssetChainDeployment
from shared.constants import BLOCKCHAIN_BASE
from shared.db import current_alias
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken, ShareTokenStatus
from wallets.models import Holding


def a_bridged_class(company, name, symbol, number):
    address = "0x" + f"{number:040x}"
    token = ShareToken.objects.create(
        company=company,
        name=name,
        symbol=symbol,
        total_supply="1000",
        status=ShareTokenStatus.DEPLOYED,
        contract_address=address,
        chain=BLOCKCHAIN_BASE,
        deployment_tx_hash="0x" + f"{number:064x}",
    )
    asset = Asset.objects.create(
        symbol=symbol,
        name=f"{company.name} {name}",
        asset_type="tokenized_security",
        decimals=0,
        is_active=True,
        is_verified=True,
    )
    AssetChainDeployment.objects.create(
        asset=asset, chain=BLOCKCHAIN_BASE, contract_address="0x" + f"{number:040X}", decimals=0
    )
    return token, asset


class AHoldingNamesItsShareClassTest(APITestCase):
    def setUp(self):
        self.issuer = make_tenant("class-issuer")
        self.holder = make_tenant("class-holder")
        self.token, self.asset = a_bridged_class(self.issuer.company, "Class A preference", "KFA", 0xA1)
        Holding.objects.create(wallet=self.holder.wallet, asset=self.asset, quantity=Decimal("120"))
        Holding.objects.create(wallet=self.holder.wallet, asset=self.holder.refs.stablecoin, quantity=Decimal("9"))
        self.client.force_authenticate(self.holder.user)

    def holdings(self):
        response = self.client.get(f"/api/wallets/{self.holder.wallet.uuid}/holdings/")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["assetSymbol"]: row for row in response.json()}

    def test_a_share_holding_names_its_class_and_company_and_other_holdings_name_none(self):
        rows = self.holdings()

        self.assertEqual(
            rows["KFA"]["shareClass"],
            {"uuid": str(self.token.uuid), "name": "Class A preference", "companyName": "class-issuer Pty Ltd"},
        )
        self.assertIsNone(rows["TUSD"]["shareClass"])
        self.assertIsNone(rows["TENANT"]["shareClass"])

    def test_a_paused_class_keeps_its_holding_and_names_no_class(self):
        ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.PAUSED)

        rows = self.holdings()

        self.assertEqual(Decimal(rows["KFA"]["quantity"]), Decimal("120"))
        self.assertEqual(rows["KFA"]["assetName"], "class-issuer Pty Ltd Class A preference")
        self.assertIsNone(rows["KFA"]["shareClass"])

    def test_every_class_is_read_inside_the_holdings_query_itself(self):
        for number, symbol in ((0xB2, "KFB"), (0xC3, "KFC")):
            _, asset = a_bridged_class(self.issuer.company, f"Class {symbol[-1]} ordinary", symbol, number)
            Holding.objects.create(wallet=self.holder.wallet, asset=asset, quantity=Decimal("3"))

        with CaptureQueriesContext(connections[current_alias()]) as captured:
            rows = self.holdings()

        reading_classes = [query["sql"] for query in captured.captured_queries if "tokens_sharetoken" in query["sql"]]
        self.assertEqual(len(reading_classes), 1)
        self.assertIn('FROM "holdings"', reading_classes[0])
        self.assertEqual(
            [rows[symbol]["shareClass"]["name"] for symbol in ("KFB", "KFC")], ["Class B ordinary", "Class C ordinary"]
        )
