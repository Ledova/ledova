from decimal import Decimal
from uuid import uuid4

from django.db import connections
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from feature_flags.models import FeatureFlag
from shared.db import APP_ALIAS, acting_for, use_migrate, use_operator
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.settlement import (
    SYNTHETIC_SETTLEMENT_CONTRACT,
    save_swap_with_context,
)
from shared.tests.tenants import make_eligible, make_tenant
from tokens.models import ShareToken, SwapOrder, TransferOrder
from tokens.tests.market_fixtures import record_synthetic_admission


@override_settings(ATOMIC_SWAP_ADDRESS=SYNTHETIC_SETTLEMENT_CONTRACT)
class TradingRetentionTest(APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.issuer = make_tenant("retention-issuer", with_swap=False)
            self.buyer = make_tenant("retention-buyer", with_swap=False)
            self.seller = make_tenant("retention-seller", with_swap=False)
            self.outsider = make_tenant("retention-outsider", with_swap=False)
            self.token = self.issuer.deployed_token
            self.buy = self.order(self.buyer, "buy")
            self.sell = self.order(self.seller, "sell")
            with use_migrate():
                record_synthetic_admission(self.buy)
                record_synthetic_admission(self.sell)
            self.legacy_order = self.order(self.buyer, "buy")
            self.swap = self.make_swap()
            self.original = {"tokenName": self.token.name, "tokenSymbol": self.token.symbol}
        self.client.force_authenticate(self.buyer.user)

    def order(self, tenant, side):
        with use_migrate():
            order = TransferOrder.objects.create(
                token=self.token,
                payment_asset=self.issuer.refs.stablecoin,
                owner_account=tenant.account,
                wallet=tenant.wallet,
                wallet_address=tenant.wallet.address,
                order_type=side,
                quantity=10,
                price_per_share=Decimal("1.50"),
            )
            order.refresh_from_db()
            self.assertEqual(
                (
                    order.eligibility_decision_id,
                    order.creation_submission_id,
                    order.last_modification_eligibility_decision_id,
                ),
                (None, None, None),
            )
        return order

    def admit_current_market(self):
        make_eligible(self.issuer)
        issuer_decision = accept_company_eligibility(self.issuer)
        for tenant in (self.buyer, self.seller):
            make_eligible(tenant)
            accept_company_eligibility(tenant, issuer_decision=issuer_decision)

    def make_swap(self):
        with use_migrate():
            return save_swap_with_context(
                sell_order=self.sell,
                buy_order=self.buy,
                share_token=self.token,
                payment_asset=self.issuer.refs.stablecoin,
                seller_address=self.seller.wallet.address,
                buyer_address=self.buyer.wallet.address,
                share_amount=2,
                payment_amount=300,
                nonce=uuid4().int % (2**62),
            )

    def pause(self):
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(status="paused")

    def orders(self, **query):
        response = self.client.get("/api/v1/trading/orders/", {"token": str(self.token.pk), **query})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def row(self, order=None):
        rows = {row["uuid"]: row for row in self.orders()["results"]}
        return rows[str((order or self.buy).pk)]

    def swaps(self, wallet=None):
        response = self.client.get("/api/v1/trading/swaps/", {"wallet_address": (wallet or self.buyer.wallet).address})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_visible_orders_keep_current_class_identity_and_both_parties_see_the_swap(self):
        self.admit_current_market()
        self.assertEqual(self.orders()["count"], 2)
        self.assertEqual(self.row()["tokenName"], self.original["tokenName"])
        for tenant in (self.buyer, self.seller):
            self.client.force_authenticate(tenant.user)
            result = self.swaps(tenant.wallet)
            self.assertEqual(result["count"], 1)
            self.assertEqual(result["results"][0]["uuid"], str(self.swap.pk))
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(name="Current visible class", symbol="LIVE")
        self.client.force_authenticate(self.buyer.user)
        self.assertEqual(self.row()["tokenName"], "Current visible class")
        self.assertEqual(self.row()["tokenSymbol"], "LIVE")

    def test_paused_class_keeps_owned_orders_and_their_recorded_identity(self):
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(name="Later hidden class", symbol="HIDDEN")
        self.pause()
        listed = self.orders()
        self.assertEqual(listed["count"], 2)
        rows = {row["uuid"]: row for row in listed["results"]}
        self.assertEqual(set(rows), {str(self.buy.pk), str(self.legacy_order.pk)})
        self.assertEqual(rows[str(self.buy.pk)]["tokenName"], self.original["tokenName"])
        self.assertEqual(rows[str(self.buy.pk)]["tokenSymbol"], self.original["tokenSymbol"])
        self.assertEqual(rows[str(self.buy.pk)]["token"], str(self.token.pk))

    def test_legacy_order_without_recorded_identity_remains_explicitly_unnamed(self):
        self.pause()
        row = self.row(self.legacy_order)
        for field in self.original:
            self.assertIn(field, row)
            self.assertIsNone(row[field])

    def test_paused_swaps_keep_recorded_names_and_exact_viewer_wallets(self):
        self.pause()
        for tenant, role in ((self.buyer, "buyer"), (self.seller, "seller")):
            self.client.force_authenticate(tenant.user)
            result = self.swaps(tenant.wallet)
            self.assertEqual(result["count"], 1)
            self.assertEqual([row["uuid"] for row in result["results"]], [str(self.swap.pk)])
            row = result["results"][0]
            self.assertEqual(row["uuid"], str(self.swap.pk))
            self.assertEqual(row["shareTokenName"], self.original["tokenName"])
            self.assertEqual(row["shareTokenSymbol"], self.original["tokenSymbol"])
            self.assertEqual(
                row["viewerParties"],
                [{"userRole": role, "ownerAccountUuid": str(tenant.account.pk), "walletUuid": str(tenant.wallet.pk)}],
            )

    def test_hidden_parent_never_grants_an_issuer_or_bystander_owned_records(self):
        self.pause()
        for tenant in (self.issuer, self.outsider):
            self.client.force_authenticate(tenant.user)
            self.assertEqual(self.orders(wallet_address=self.buyer.wallet.address)["count"], 0)
            self.assertEqual(self.swaps(tenant.wallet)["count"], 0)
            response = self.client.get("/api/v1/trading/swaps/", {"wallet_address": self.buyer.wallet.address})
            self.assertEqual(response.status_code, 404, response.content)

    def test_hidden_orders_keep_filtering_and_search_by_owned_recorded_identity(self):
        self.pause()
        self.assertEqual(self.orders(order_type="sell")["count"], 0)
        self.assertEqual(self.orders(wallet_address=self.seller.wallet.address)["count"], 0)
        self.assertEqual(self.orders(search=self.original["tokenSymbol"])["count"], 1)
        self.assertEqual(self.orders(search=self.original["tokenName"])["count"], 1)
        self.assertEqual(self.orders(search=self.buyer.wallet.address)["count"], 2)
        self.assertEqual(self.orders(search="nonexistent-class")["count"], 0)

    def test_company_directory_and_compliance_states_keep_owned_records(self):
        for status, opened in (("active", False), ("warning", True), ("suspended", True)):
            with self.subTest(status=status, opened=opened):
                with use_migrate():
                    Company.objects.filter(pk=self.issuer.company.pk).update(status=status, is_open_to_investors=opened)
                self.assertEqual(self.orders()["count"], 2)
                self.assertEqual(self.row()["tokenSymbol"], self.original["tokenSymbol"])
                self.assertEqual(self.swaps()["count"], 1)

    def test_paused_order_pagination_keeps_every_owned_row(self):
        with use_operator():
            additional = [self.order(self.buyer, "buy") for _ in range(26)]
        self.pause()
        first = self.orders()
        second = self.orders(page=2)
        self.assertEqual(first["count"], 28)
        self.assertEqual(second["count"], 28)
        self.assertIsNotNone(first["next"])
        self.assertIsNone(second["next"])
        rows = first["results"] + second["results"]
        expected = {str(order.pk) for order in [self.buy, self.legacy_order, *additional]}
        self.assertEqual(len(rows), len(expected))
        self.assertEqual({row["uuid"] for row in rows}, expected)


class ScopedTradingRetentionTest(RunsOnTheScopedConnection, TradingRetentionTest):
    def test_class_disappears_under_the_non_bypass_buyer_role_while_records_remain(self):
        self.admit_current_market()
        with acting_for(self.buyer.user.pk):
            with connections[APP_ALIAS].cursor() as cursor:
                cursor.execute("SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user")
                self.assertEqual(cursor.fetchone(), ("ledova_app", False))
            self.assertTrue(ShareToken.objects.filter(pk=self.token.pk).exists())
        self.pause()
        with acting_for(self.buyer.user.pk):
            self.assertFalse(ShareToken.objects.filter(pk=self.token.pk).exists())
            self.assertTrue(TransferOrder.objects.filter(pk=self.buy.pk).exists())
            self.assertTrue(SwapOrder.objects.filter(pk=self.swap.pk).exists())
        self.assertEqual(self.row()["tokenName"], self.original["tokenName"])
        self.assertEqual(self.swaps()["results"][0]["uuid"], str(self.swap.pk))
