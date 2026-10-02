from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from blockchain.tests.outgoing_fixtures import admitted_signer
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import (
    ADMIN_STORAGES,
    PASSWORD,
    grant,
    staff_user,
)
from tokens.models import (
    OrderSubmission,
    SigningChallenge,
    SwapOrder,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.services import swap_execution
from tokens.services.trading_order_service import TradingOrderService
from tokens.tests.market_fixtures import make_market_tenant
from tokens.tests.order_submission_fixtures import pending_submission
from tokens.tests.swap_execution_fixtures import ExecutionNode, make_execution
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER

User = get_user_model()

MARKET = (TransferOrder, SwapOrder, OrderSubmission)
REFUSAL = "The wallet holds fewer shares than the order sells."


def changelist(model):
    return reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist")


def change(row):
    return reverse(f"admin:{row._meta.app_label}_{row._meta.model_name}_change", args=[row.pk])


def delete(row):
    return reverse(f"admin:{row._meta.app_label}_{row._meta.model_name}_delete", args=[row.pk])


def add(model):
    return reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_add")


def refused_admission(tenant):
    submission = pending_submission(tenant, order_type="sell", quantity=500)
    issued = TradingOrderService.get_order_create_message(
        token=submission.token,
        wallet_address=submission.wallet_address,
        order_type=submission.order_type,
        quantity=submission.quantity,
        min_quantity=submission.min_quantity,
        price_per_share=submission.price_per_share,
        wallet=submission.wallet,
        submission=submission,
    )
    challenge = SigningChallenge.objects.get(digest=issued["digest"])
    challenge.mark_consumed("synthetic-refusal")
    OrderSubmission.objects.filter(pk=submission.pk).update(
        status="refused",
        executed_challenge=challenge,
        resolved_at=timezone.now(),
        refusal_code="insufficient_balance",
        refusal_detail=REFUSAL,
    )
    return OrderSubmission.objects.get(pk=submission.pk)


def rows_of(response):
    return {row.pk for row in response.context["cl"].result_list}


class TheMarketHasAdminPagesTest(TestCase):

    def test_orders_settlements_and_their_admissions_are_registered(self):
        self.assertEqual({model for model in MARKET if model in admin.site._registry}, set(MARKET))


class SettlementPaymentTest(SimpleTestCase):

    def test_the_payment_is_read_in_the_units_the_settlement_signed(self):
        payment = admin.site._registry[SwapOrder].payment
        signed = SimpleNamespace(
            payment_amount=1_500_000,
            settlement_context={"payment_asset": {"symbol": "AUDY", "pricing_decimals": 2, "deployment_decimals": 6}},
        )
        historical = SimpleNamespace(payment_amount=1500, settlement_context=None)

        self.assertEqual(payment(signed), "1.500000 AUDY")
        self.assertEqual(payment(historical), "1500 base units")


@override_settings(STORAGES=ADMIN_STORAGES)
class MarketAdminPagesTest(TestCase):

    def setUp(self):
        self.tenant = make_market_tenant("market-admin")
        self.orders = {self.tenant.order.pk, self.tenant.counter_order.pk}
        self.admission = OrderSubmission.objects.get(order=self.tenant.order)
        self.refused = refused_admission(self.tenant)
        self.client.force_login(User.objects.create_superuser(email="market-admin@example.test", password=PASSWORD))

    def test_staff_find_every_order_settlement_and_admission(self):
        for model, expected, filters in (
            (TransferOrder, self.orders, {"status", "order type"}),
            (SwapOrder, {self.tenant.swap.pk}, {"status"}),
            (
                OrderSubmission,
                set(OrderSubmission.objects.values_list("pk", flat=True)),
                {"status", "refusal code", "order type"},
            ),
        ):
            with self.subTest(model=model._meta.label):
                response = self.client.get(changelist(model))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(rows_of(response), expected)
                self.assertContains(response, self.tenant.deployed_token.symbol)
                listing = response.context["cl"]
                self.assertEqual({spec.title for spec in listing.filter_specs}, filters)
                self.assertEqual(listing.date_hierarchy, "created_at")
                if model is not SwapOrder:
                    self.assertContains(response, self.tenant.user.email)
        self.assertEqual(len(rows_of(self.client.get(changelist(OrderSubmission)))), 3)

    def test_the_order_list_filters_searches_and_drills_down_by_date(self):
        sell = {self.tenant.order.pk}
        today = timezone.localdate()
        for query, expected in (
            ({"order_type__exact": "sell"}, sell),
            ({"status__exact": TransferOrderStatus.OPEN}, self.orders),
            ({"status__exact": TransferOrderStatus.CANCELLED}, set()),
            ({"q": self.tenant.wallet.address}, self.orders),
            ({"q": self.tenant.user.email}, self.orders),
            ({"q": "no-such-trader@example.test"}, set()),
            ({"created_at__year": today.year, "created_at__month": today.month}, self.orders),
            ({"created_at__year": today.year - 1}, set()),
        ):
            with self.subTest(query=query):
                response = self.client.get(changelist(TransferOrder), query)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(rows_of(response), expected)

    def test_an_order_links_its_share_class_owner_wallet_admission_and_settlement(self):
        response = self.client.get(change(self.tenant.order))

        self.assertEqual(response.status_code, 200)
        for target in (
            self.tenant.deployed_token,
            self.tenant.account,
            self.tenant.wallet,
            self.admission,
            self.tenant.swap,
        ):
            with self.subTest(target=target._meta.label):
                self.assertContains(response, change(target))
        self.assertContains(self.client.get(change(self.tenant.counter_order)), change(self.tenant.swap))

    def test_a_settlement_links_both_orders_their_wallets_and_their_owners(self):
        response = self.client.get(change(self.tenant.swap))

        self.assertEqual(response.status_code, 200)
        for target in (
            self.tenant.order,
            self.tenant.counter_order,
            self.tenant.wallet,
            self.tenant.account,
            self.tenant.deployed_token,
        ):
            with self.subTest(target=target._meta.label):
                self.assertContains(response, change(target))
        self.assertContains(response, "15.00 TUSD")
        self.assertContains(response, "Not relayed")

    def test_a_refused_admission_says_why_and_the_list_finds_it(self):
        refused = self.client.get(changelist(OrderSubmission), {"status__exact": "refused"})
        page = self.client.get(change(self.refused))

        self.assertEqual(rows_of(refused), {self.refused.pk})
        self.assertContains(page, "insufficient_balance")
        self.assertContains(page, REFUSAL)

    def test_nothing_on_the_market_pages_adds_changes_or_deletes_a_row(self):
        for model, row in (
            (TransferOrder, self.tenant.order),
            (SwapOrder, self.tenant.swap),
            (OrderSubmission, self.admission),
        ):
            with self.subTest(model=model._meta.label):
                before = model.objects.filter(pk=row.pk).values().get()
                self.assertEqual(self.client.get(add(model)).status_code, 403)
                page = self.client.get(change(row))
                self.assertEqual(page.status_code, 200)
                self.assertNotContains(page, 'name="_save"')
                self.assertNotContains(page, delete(row))
                self.assertEqual(self.client.post(change(row), {}).status_code, 403)
                self.assertEqual(self.client.get(delete(row)).status_code, 403)
                self.assertEqual(self.client.post(delete(row), {"post": "yes"}).status_code, 403)
                listed = self.client.post(
                    changelist(model), {"action": "delete_selected", "_selected_action": [row.pk], "post": "yes"}
                )
                self.assertNotContains(listed, 'name="action"')
                self.assertEqual(model.objects.filter(pk=row.pk).values().get(), before)


@override_settings(STORAGES=ADMIN_STORAGES)
class MarketAdminPermissionTest(TestCase):

    def setUp(self):
        self.tenant = make_market_tenant("market-permissions")
        self.rows = {
            TransferOrder: self.tenant.order,
            SwapOrder: self.tenant.swap,
            OrderSubmission: OrderSubmission.objects.get(order=self.tenant.order),
        }

    def test_staff_without_the_view_permission_are_refused(self):
        self.client.force_login(staff_user("market-plain"))
        self.assertEqual(self.client.get(reverse("admin:index")).status_code, 200)

        for model, row in self.rows.items():
            with self.subTest(model=model._meta.label):
                self.assertEqual(self.client.get(changelist(model)).status_code, 403)
                self.assertEqual(self.client.get(change(row)).status_code, 403)

    def test_the_view_permission_opens_each_page_and_nothing_more(self):
        for index, (model, row) in enumerate(self.rows.items()):
            with self.subTest(model=model._meta.label):
                viewer = grant(staff_user(f"market-viewer-{index}"), admin.site._registry[model], "view")
                self.client.force_login(viewer)
                self.assertEqual(self.client.get(changelist(model)).status_code, 200)
                page = self.client.get(change(row))
                self.assertEqual(page.status_code, 200)
                self.assertNotContains(page, 'name="_save"')
                self.assertEqual(self.client.post(change(row), {}).status_code, 403)
                self.assertEqual(self.client.get(add(model)).status_code, 403)
                self.assertEqual(self.client.get(delete(row)).status_code, 403)

    def test_change_add_and_delete_permissions_do_not_unlock_a_write(self):
        for index, (model, row) in enumerate(self.rows.items()):
            with self.subTest(model=model._meta.label):
                model_admin = admin.site._registry[model]
                editor = staff_user(f"market-editor-{index}")
                for action in ("add", "change", "delete"):
                    editor = grant(editor, model_admin, action)
                self.client.force_login(editor)
                self.assertEqual(self.client.get(change(row)).status_code, 200)
                self.assertEqual(self.client.post(change(row), {}).status_code, 403)
                self.assertEqual(self.client.get(add(model)).status_code, 403)
                self.assertEqual(self.client.post(delete(row), {"post": "yes"}).status_code, 403)
                self.assertTrue(model.objects.filter(pk=row.pk).exists())

    def test_a_signed_in_customer_is_sent_to_the_admin_login(self):
        self.client.force_login(self.tenant.user)

        for model in self.rows:
            with self.subTest(model=model._meta.label):
                response = self.client.get(changelist(model))
                self.assertEqual(response.status_code, 302)
                self.assertTrue(response["Location"].startswith(reverse("admin:login")))


@override_settings(STORAGES=ADMIN_STORAGES, ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
class SettlementTransactionPageTest(TransactionTestCase):

    def setUp(self):
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        self.fixture = make_execution("settlement-page")
        admitted_signer(chain_id=settings.BLOCKCHAIN_CHAIN_ID)
        for participant, key in (("seller", SELLER), ("buyer", BUYER)):
            self.swap = swap_execution.submit_signature(
                self.fixture.swap,
                self.fixture.signatures[participant],
                key.address,
                user=getattr(self.fixture, participant).user,
                participant=participant,
            )
        self.relayed = self.swap.transaction
        swap_execution.recover(self.relayed.pk, client=ExecutionNode(self.relayed.function_args).client)
        self.relayed.refresh_from_db()
        self.client.force_login(User.objects.create_superuser(email="settlement@example.test", password=PASSWORD))

    def test_the_settlement_page_shows_the_relayed_transaction_and_its_receipt(self):
        response = self.client.get(change(self.swap))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.relayed.status, "confirmed")
        self.assertContains(response, self.relayed.tx_hash)
        self.assertContains(response, "Confirmed in block 12")
        parties = (
            (self.fixture.orders[0], self.swap.seller_wallet, self.fixture.seller.account),
            (self.fixture.orders[1], self.swap.buyer_wallet, self.fixture.buyer.account),
        )
        for order, wallet, account in parties:
            for target in (order, wallet, account):
                self.assertContains(response, change(target))
        self.assertNotEqual(self.fixture.seller.account, self.fixture.buyer.account)


@override_settings(STORAGES=ADMIN_STORAGES)
class ScopedMarketAdminTest(RunsOnTheScopedConnection, APITransactionTestCase):

    def setUp(self):
        with use_operator():
            self.first = make_market_tenant("scoped-market-one")
            self.second = make_market_tenant("scoped-market-two")
            viewer = staff_user("scoped-market-viewer")
            for model in MARKET:
                viewer = grant(viewer, admin.site._registry[model], "view")
            self.client.force_login(viewer)

    def orders_of(self, tenant):
        return {tenant.order.pk, tenant.counter_order.pk}

    def test_staff_see_every_traders_orders_and_settlements_on_the_operator_connection(self):
        orders = self.client.get(changelist(TransferOrder))
        settlements = self.client.get(changelist(SwapOrder))
        foreign = self.client.get(change(self.second.order))

        self.assertEqual(rows_of(orders), self.orders_of(self.first) | self.orders_of(self.second))
        self.assertEqual(rows_of(settlements), {self.first.swap.pk, self.second.swap.pk})
        self.assertEqual(foreign.status_code, 200)
        self.the_principal_the_middleware_would_set(self.first.user)
        self.assertEqual(set(TransferOrder.objects.values_list("pk", flat=True)), self.orders_of(self.first))
