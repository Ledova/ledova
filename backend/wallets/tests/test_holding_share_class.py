from decimal import Decimal

from django.conf import settings
from django.db import connections
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase, APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from companies.models import Company
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken, ShareTokenStatus
from wallets.models import Holding, Transaction


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

    def test_a_case_variant_contract_names_its_class_and_other_holdings_name_none(self):
        rows = self.holdings()

        self.assertEqual(
            rows["KFA"]["shareClass"],
            {
                "uuid": str(self.token.uuid),
                "name": "Class A preference",
                "symbol": "KFA",
                "companyName": "class-issuer Pty Ltd",
            },
        )
        self.assertIsNone(rows["TUSD"]["shareClass"])
        self.assertIsNone(rows["TENANT"]["shareClass"])

    def test_an_asset_without_a_base_deployment_keeps_its_holding_without_a_class(self):
        AssetChainDeployment.objects.filter(asset=self.asset).update(chain="ethereum")

        row = self.holdings()["KFA"]

        self.assertEqual(Decimal(row["quantity"]), Decimal("120"))
        self.assertIsNone(row["shareClass"])

    def test_an_unmatched_base_contract_keeps_its_holding_without_a_class(self):
        AssetChainDeployment.objects.filter(asset=self.asset).update(contract_address="0x" + "f" * 40)

        row = self.holdings()["KFA"]

        self.assertEqual(Decimal(row["quantity"]), Decimal("120"))
        self.assertIsNone(row["shareClass"])

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


class ScopedHoldingShareClassTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.issuer = make_tenant("scoped-class-issuer")
            self.holder = make_tenant("scoped-class-holder")
            self.bystander = make_tenant("scoped-class-bystander")
            self.token, self.asset = a_bridged_class(self.issuer.company, "Class A preference", "KFA", 0xA1)
            for tenant, quantity in ((self.issuer, "40"), (self.holder, "120")):
                Holding.objects.create(wallet=tenant.wallet, asset=self.asset, quantity=Decimal(quantity))

    def holdings_for(self, tenant):
        self.client.force_authenticate(tenant.user)
        response = self.client.get(f"/api/wallets/{tenant.wallet.uuid}/holdings/")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["assetSymbol"]: row for row in response.json()}

    def test_an_investor_reads_the_visible_class_on_the_non_bypassing_app_connection(self):
        with connections[APP_ALIAS].cursor() as cursor:
            cursor.execute("SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user")
            self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES[APP_ALIAS], False, False))
        with CaptureQueriesContext(connections[APP_ALIAS]) as captured:
            row = self.holdings_for(self.holder)["KFA"]

        self.assertEqual(
            row["shareClass"],
            {
                "uuid": str(self.token.uuid),
                "name": "Class A preference",
                "symbol": "KFA",
                "companyName": "scoped-class-issuer Pty Ltd",
            },
        )
        reading_classes = [query["sql"] for query in captured.captured_queries if "tokens_sharetoken" in query["sql"]]
        self.assertEqual(len(reading_classes), 1)
        self.assertIn('FROM "holdings"', reading_classes[0])

    def test_each_actor_reads_only_their_own_wallets_holdings(self):
        for actor in (self.issuer, self.holder, self.bystander):
            with self.subTest(actor=actor.label):
                rows = self.holdings_for(actor)
                self.assertIn("TENANT", rows)
                self.assertEqual("KFA" in rows, actor != self.bystander)
                for foreign in (self.issuer, self.holder, self.bystander):
                    if actor != foreign:
                        response = self.client.get(f"/api/wallets/{foreign.wallet.uuid}/holdings/")
                        self.assertEqual(response.status_code, 404, response.content)

    def test_a_paused_class_is_hidden_from_the_investor_without_removing_the_holding(self):
        before = self.holdings_for(self.holder)["KFA"]
        self.assertEqual(before["shareClass"]["uuid"], str(self.token.uuid))
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.PAUSED)

        after = self.holdings_for(self.holder)["KFA"]

        self.assertIsNone(after["shareClass"])
        self.assertEqual(
            (after["uuid"], after["quantity"], after["assetName"]),
            (before["uuid"], before["quantity"], before["assetName"]),
        )

    def test_a_company_owner_still_names_its_own_paused_class_under_the_owner_policy(self):
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.PAUSED)

        owner = self.holdings_for(self.issuer)["KFA"]
        investor = self.holdings_for(self.holder)["KFA"]

        self.assertEqual(owner["shareClass"]["uuid"], str(self.token.uuid))
        self.assertEqual(owner["shareClass"]["companyName"], "scoped-class-issuer Pty Ltd")
        self.assertIsNone(investor["shareClass"])

    def test_activity_names_the_class_inside_the_transactions_query_and_hides_a_paused_one_from_the_investor(self):
        with use_operator():
            for tenant in (self.issuer, self.holder):
                Transaction.objects.create(
                    wallet=tenant.wallet,
                    asset=self.asset,
                    tx_hash=f"0x{tenant.label}-class",
                    chain=BLOCKCHAIN_BASE,
                    from_address="0x" + "3" * 40,
                    to_address=tenant.wallet.address,
                    amount=Decimal("7"),
                )

        def activity(tenant):
            self.client.force_authenticate(tenant.user)
            response = self.client.get("/api/transactions/", {"wallet": str(tenant.wallet.uuid)})
            self.assertEqual(response.status_code, 200, response.content)
            return {row["assetSymbol"]: row["shareClass"] for row in response.json()["results"]}

        with CaptureQueriesContext(connections[APP_ALIAS]) as captured:
            listed = activity(self.holder)["KFA"]

        self.assertEqual((listed["uuid"], listed["symbol"]), (str(self.token.uuid), "KFA"))
        reading_classes = [query["sql"] for query in captured.captured_queries if "tokens_sharetoken" in query["sql"]]
        self.assertEqual(len(reading_classes), 1)
        self.assertIn('FROM "transactions"', reading_classes[0])
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.PAUSED)

        self.assertIsNone(activity(self.holder)["KFA"])
        self.assertEqual(activity(self.issuer)["KFA"]["symbol"], "KFA")

    def test_class_and_company_renames_are_read_again_without_rewriting_the_asset(self):
        before = self.holdings_for(self.holder)["KFA"]
        self.assertEqual(before["shareClass"]["name"], "Class A preference")
        self.assertEqual(before["shareClass"]["companyName"], "scoped-class-issuer Pty Ltd")
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(name="Class A ordinary")
            Company.objects.filter(pk=self.issuer.company.pk).update(name="Renamed synthetic company Pty Ltd")

        after = self.holdings_for(self.holder)["KFA"]

        self.assertEqual(
            after["shareClass"],
            {
                "uuid": str(self.token.uuid),
                "name": "Class A ordinary",
                "symbol": "KFA",
                "companyName": "Renamed synthetic company Pty Ltd",
            },
        )
        self.assertEqual(after["assetName"], before["assetName"])
