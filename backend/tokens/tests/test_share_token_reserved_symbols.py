from django.contrib import admin
from django.test import RequestFactory
from rest_framework.test import APITestCase

from assets.services.sync import SUPPORTED_ASSETS
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken

URL = "/api/v1/tokens/"


def reserved(symbol):
    return f"{symbol} is the symbol of a supported asset. Choose another symbol for this share class."


class ReservedShareSymbolTest(APITestCase):
    def setUp(self):
        self.tenant = make_tenant("reserved")
        self.client.force_authenticate(self.tenant.user)

    def create(self, symbol):
        return self.client.post(
            URL,
            {"name": "Reserved", "symbol": symbol, "tokenType": "ordinary", "totalSupply": "10"},
            format="json",
        )

    def test_a_new_class_cannot_take_any_supported_asset_symbol_in_any_case(self):
        before = ShareToken.objects.count()
        for symbol in SUPPORTED_ASSETS:
            for written in (symbol, symbol.lower(), symbol.title()):
                with self.subTest(symbol=written):
                    response = self.create(written)
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertEqual(response.json(), {"symbol": [reserved(symbol)]})
        self.assertEqual(ShareToken.objects.count(), before)
        created = self.create("rsvd")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["symbol"], "RSVD")

    def test_an_existing_class_keeps_its_symbol_and_admin_refuses_only_a_new_or_changed_reserved_one(self):
        existing = ShareToken.objects.create(
            company=self.tenant.company, name="Earlier class", symbol="USDC", total_supply="1000"
        )
        listed = self.client.get(URL, {"status": "draft"}).json()["results"]
        self.assertIn("USDC", [row["symbol"] for row in listed])
        request = RequestFactory().get("/admin/")
        request.user = make_tenant("reserved-admin", superuser=True).user
        model_admin = admin.site._registry[ShareToken]
        adding = model_admin.get_form(request)
        changing = model_admin.get_form(request, existing)
        for form, symbol, refused in (
            (adding(data={"symbol": "usdt"}), "USDT", True),
            (adding(data={"symbol": "RSVD"}), "RSVD", False),
            (changing(data={"symbol": "USDC"}, instance=existing), "USDC", False),
            (changing(data={"symbol": "AUDY"}, instance=existing), "AUDY", True),
        ):
            with self.subTest(symbol=symbol, adding=form.instance._state.adding):
                form.is_valid()
                if refused:
                    self.assertEqual(form.errors["symbol"], [reserved(symbol)])
                else:
                    self.assertNotIn("symbol", form.errors)
        existing.refresh_from_db()
        self.assertEqual(existing.symbol, "USDC")
