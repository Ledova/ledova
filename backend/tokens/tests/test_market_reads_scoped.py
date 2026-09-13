from contextlib import ExitStack
from uuid import UUID, uuid4

from django.conf import settings
from django.db import connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from feature_flags.models import FeatureFlag
from shared.db import APP_ALIAS, OPERATOR_ALIAS, acting_for, principal_of, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_eligible, make_tenant, open_to_investors
from tokens.models import SwapOrder, TransferOrder
from tokens.tests.test_market_summary import DIRECTORY, TRADING


class ScopedMarketReadsTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.reader = make_tenant("market-reader")
            self.issuer = make_tenant("market-issuer")
            make_eligible(self.reader)
            open_to_investors(self.issuer)
            SwapOrder.objects.filter(pk=self.issuer.swap.pk).update(status="completed", completed_at=timezone.now())
        self.client.force_authenticate(self.reader.user)
        self.statements = []

    def record_sql(self, execute, sql, params, many, context):
        if 'FROM "tokens_sharetoken"' in sql and '"best_bid"' in sql:
            connection = context["connection"]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            self.statements.append((connection.alias, role, sql, params))
        return execute(sql, params, many, context)

    def test_lists_publish_other_parties_prices_with_one_query_bounded_to_the_admitted_page(self):
        for path in (TRADING, DIRECTORY):
            self.statements.clear()
            with self.subTest(path=path), ExitStack() as stack:
                for alias in (APP_ALIAS, OPERATOR_ALIAS):
                    stack.enter_context(connections[alias].execute_wrapper(self.record_sql))
                response = self.client.get(path)
            self.assertEqual(response.status_code, 200, response.content)
            rows = {row["uuid"]: row for row in response.json()["results"]}
            row = rows[str(self.issuer.deployed_token.pk)]
            self.assertEqual((row["lastPrice"], row["bestBid"], row["bestAsk"]), ("1.5", "1.50", "1.50"))
            self.assertEqual(len(self.statements), 1)
            alias, role, _, params = self.statements[0]
            self.assertEqual((alias, role), (OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS]))
            self.assertEqual({str(value) for value in params if isinstance(value, UUID)}, set(rows))
        with acting_for(self.reader.user.pk):
            self.assertFalse(TransferOrder.objects.filter(pk=self.issuer.order.pk).exists())
            self.assertFalse(SwapOrder.objects.filter(pk=self.issuer.swap.pk).exists())
            self.assertTrue(TransferOrder.objects.filter(pk=self.reader.order.pk).exists())
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def test_market_detail_and_order_book_publish_prices_and_levels_without_order_identity(self):
        token = self.issuer.deployed_token
        market = self.client.get(f"{TRADING}{token.pk}/market-data/")
        self.assertEqual(market.status_code, 200, market.content)
        body = market.json()
        self.assertEqual((body["lastTradePrice"], body["bestBid"], body["bestAsk"]), ("1.5", "1.50", "1.50"))
        book = self.client.get(f"{TRADING}{token.pk}/order-book/")
        self.assertEqual(book.status_code, 200, book.content)
        for side in ("buyOrders", "sellOrders"):
            self.assertTrue(book.json()[side])
            self.assertEqual(set(book.json()[side][0]), {"price", "quantity", "orders"})
        for response in (market, book):
            self.assertNotIn(str(self.issuer.order.pk).encode(), response.content)
            self.assertNotIn(self.issuer.wallet.address.encode(), response.content)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def test_ineligible_and_unknown_token_requests_never_reach_the_operator_summary(self):
        with use_operator():
            visitor = make_tenant("market-ineligible")
        self.client.force_authenticate(visitor.user)
        with connections[OPERATOR_ALIAS].execute_wrapper(self.record_sql):
            self.assertEqual(self.client.get(TRADING).json()["results"], [])
            for token_id in (self.issuer.deployed_token.pk, uuid4()):
                self.assertEqual(self.client.get(f"{TRADING}{token_id}/").status_code, 404)
        self.assertEqual(self.statements, [])
        self.client.force_authenticate(self.reader.user)
        response = self.client.get(f"{TRADING}{self.issuer.deployed_token.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["bestBid"], "1.50")
