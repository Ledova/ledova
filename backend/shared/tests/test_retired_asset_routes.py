from decimal import Decimal
from uuid import uuid4

from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APITestCase

from assets.models import Asset, AssetChainDeployment, AssetSnapshot, ExchangeRate
from portfolios.tests.test_live_authorization import PortfolioFixtureMixin
from shared.api.routes import registered_routes

RETIRED_ROUTES = {
    ("get", "/api/assets/{}/"),
    ("get", "/api/assets/{}/snapshots/"),
    ("get", "/api/portfolios/{}/snapshots/"),
    ("get", "/api/favourite-assets/"),
    ("post", "/api/favourite-assets/"),
    ("get", "/api/favourite-assets/{}/"),
    ("delete", "/api/favourite-assets/{}/"),
}
RETAINED_ROUTES = {
    ("get", "/api/assets/"),
    ("get", "/api/assets/exchange-rates/"),
    ("get", "/api/portfolios/{}/"),
    ("post", "/api/portfolios/{}/add-wallet/"),
    ("post", "/api/portfolios/{}/remove-wallet/"),
}


class RetiredAssetRoutesTest(PortfolioFixtureMixin, APITestCase):
    def setUp(self):
        self.user, _, self.account, self.portfolio, self.wallet = self.make_tenant("alice")
        self.client.force_authenticate(self.user)
        self.asset = Asset.objects.create(
            symbol="USDC", name="USD Coin", asset_type="stablecoin", decimals=6, is_verified=True
        )
        AssetChainDeployment.objects.create(asset=self.asset, chain="ethereum", decimals=6)
        self.asset_snapshot = AssetSnapshot.objects.create(
            asset=self.asset, price=Decimal("1"), source_timestamp=timezone.now(), data_source="manual"
        )
        self.portfolio.wallets.add(self.wallet)

    def test_retired_operations_are_not_registered_and_supported_operations_remain(self):
        routes = registered_routes()

        self.assertEqual(RETIRED_ROUTES & routes, set())
        self.assertTrue(RETAINED_ROUTES <= routes)

    def test_generated_schema_omits_retired_paths_and_keeps_supported_paths(self):
        paths = SchemaGenerator().get_schema(request=None, public=True)["paths"]

        for _, path in RETIRED_ROUTES:
            with self.subTest(path=path):
                self.assertNotIn(path.replace("{}", "{uuid}"), paths)
        for _, path in RETAINED_ROUTES:
            with self.subTest(path=path):
                self.assertIn(path.replace("{}", "{uuid}"), paths)

    def test_retired_paths_return_404_without_changing_retained_data(self):
        before = list(AssetSnapshot.objects.values())
        favourite = uuid4()
        requests = (
            ("get", f"/api/assets/{self.asset.uuid}/", {}),
            ("get", f"/api/assets/{self.asset.uuid}/snapshots/", {}),
            ("get", f"/api/portfolios/{self.portfolio.uuid}/snapshots/", {}),
            ("get", "/api/favourite-assets/", {}),
            (
                "post",
                "/api/favourite-assets/",
                {"userAccount": str(self.account.uuid), "asset": str(self.asset.uuid)},
            ),
            ("get", f"/api/favourite-assets/{favourite}/", {}),
            ("delete", f"/api/favourite-assets/{favourite}/", {}),
        )

        for method, path, payload in requests:
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path, payload, format="json")
                self.assertEqual(response.status_code, 404)
        self.assertEqual(list(AssetSnapshot.objects.values()), before)

    def test_catalogue_exchange_rates_and_portfolio_wallet_actions_still_work(self):
        response = self.client.get("/api/assets/", {"chain": "ethereum"})
        self.assertEqual(response.status_code, 200)
        self.assertIn(str(self.asset.uuid), {row["uuid"] for row in self.rows(response)})
        ExchangeRate.objects.create(base_currency="USD", target_currency="AUD", rate=Decimal("1.25"))
        response = self.client.get("/api/assets/exchange-rates/", {"currency": "AUD"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rate"], "1.2500000000")
        self.assertEqual(self.client.get(f"/api/portfolios/{self.portfolio.uuid}/").status_code, 200)

        for action, expected in (("remove-wallet", []), ("add-wallet", [str(self.wallet.uuid)])):
            with self.subTest(action=action):
                response = self.client.post(
                    f"/api/portfolios/{self.portfolio.uuid}/{action}/",
                    {"walletUuid": str(self.wallet.uuid)},
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["portfolio"]["walletUuids"], expected)
                self.assertEqual(
                    [str(uuid) for uuid in self.portfolio.wallets.values_list("uuid", flat=True)], expected
                )
