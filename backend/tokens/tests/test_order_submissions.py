from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from jsonschema import Draft4Validator, RefResolver
from rest_framework.test import APITransactionTestCase

from assets.models import AssetChainDeployment
from operators.settlement import require_deployment
from shared.db import acting_for, atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from shared.utils.typed_data import signable_message, typed_data_digest
from tokens.exceptions import (
    CreateOrderNotWhitelistedException,
    InsufficientBalanceException,
    InvalidSettlementAmountException,
    OrderMatchException,
    TokenBalanceRetrievalException,
)
from tokens.models import (
    OrderSubmission,
    ShareToken,
    SigningChallenge,
    SigningChallengePurpose,
    SwapOrder,
    TransferOrder,
)
from tokens.services import token_transfer_service
from tokens.services.settlement_context import recorded_settlement_context
from tokens.tests.order_submission_fixtures import (
    OTHER_KEY,
    OWNER,
    SubmissionFixtures,
    pending_submission,
)
from wallets.models import Wallet


class SubmissionRecoveryChecks(SubmissionFixtures):
    def test_original_integer_terms_remain_lossless_when_recovering_a_pending_submission(self):
        body = self.body(quantity="9007199254740993", min_quantity="9007199254740992")
        issued = self.message(body)
        self.assertEqual(issued.status_code, 200, issued.content)
        for response in (issued, self.recover()):
            self.assertEqual(response.status_code, 200, response.content)
            intent = response.json()["intent"]
            self.assertEqual(intent["quantity"], body["quantity"])
            self.assertEqual(intent["minQuantity"], body["min_quantity"])
        renewed = self.message({**body, "quantity": intent["quantity"], "min_quantity": intent["minQuantity"]})
        self.assertEqual(renewed.status_code, 200, renewed.content)
        message = renewed.json()["challenge"]["message"]
        self.assertEqual(message["quantity"], body["quantity"])
        self.assertEqual(message["minQuantity"], body["min_quantity"])
        self.assertEqual(renewed.json()["intent"], issued.json()["intent"])
        self.assertEqual(self.submission().status, "pending")
        self.chain.send_raw_transaction.assert_not_called()

    def test_first_created_snapshot_uses_the_current_order_after_matching(self):
        self.counter_order()
        created = self.create(self.signed_body())
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["order"]["status"], "pending_signature")
        self.assertEqual(self.recover().json(), created.json())

    def test_a_lost_create_response_recovers_one_order_match_and_event_set(self):
        counter = self.counter_order()
        signed = self.signed_body()
        with use_operator():
            initial_swaps = SwapOrder.objects.count()
        with patch(
            "tokens.views.trading_order.submission_snapshot", side_effect=RuntimeError("synthetic lost response")
        ):
            lost = self.create(signed)
        self.assertEqual(lost.status_code, 500)
        recovered = self.create(signed)
        self.assertEqual(recovered.status_code, 200, recovered.content)
        result = recovered.json()
        self.assertEqual(result["status"], "created")
        self.assertEqual(result["match"]["counterOrder"], str(counter.pk))
        self.assertEqual(result["order"]["filledQuantity"], 10)
        self.assertEqual(self.recover().json(), result)
        with use_operator():
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 1)
            self.assertEqual(SwapOrder.objects.count(), initial_swaps + 1)
            counter.refresh_from_db()
            self.assertEqual(counter.filled_quantity, 10)
            self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
        self.assertEqual([event[0] for event in self.events], ["order_created", "order_matched"])
        self.assertTrue(all(not event[3] for event in self.events))
        self.chain.send_raw_transaction.assert_not_called()

    def test_two_challenges_for_one_submission_converge_without_spending_the_second(self):
        first = self.signed_body()
        second = self.signed_body()
        self.assertNotEqual(first["digest"], second["digest"])
        created = self.create(first)
        recovered = self.create(second)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(created.json(), recovered.json())
        with use_operator():
            self.assertTrue(SigningChallenge.objects.get(digest=first["digest"]).is_consumed)
            self.assertFalse(SigningChallenge.objects.get(digest=second["digest"]).is_consumed)
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 1)
        self.assertEqual(len(self.events), 1)

    def test_two_deliberate_equal_buys_create_two_orders_for_twenty_shares(self):
        first = self.create(self.signed_body())
        second = self.create(self.signed_body(self.body(submission_id=str(uuid4()))))
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertNotEqual(first.json()["order"]["uuid"], second.json()["order"]["uuid"])
        with use_operator():
            orders = TransferOrder.objects.filter(submission__isnull=False, wallet=self.wallet)
            self.assertEqual(sorted(orders.values_list("quantity", flat=True)), [10, 10])
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 2)
        self.assertEqual(len(self.events), 2)

    def test_changed_original_terms_conflict_before_spending_or_recovering(self):
        signed = self.signed_body()
        changes = (
            {"quantity": 11},
            {"min_quantity": 5},
            {"price_per_share": "2.51"},
            {"order_type": "sell"},
            {"token": str(self.tenant.token.pk)},
            {"wallet_uuid": str(self.tenant.wallet.pk), "wallet_address": self.tenant.wallet.address},
        )
        for change in changes:
            with self.subTest(change=change):
                response = self.create({**signed, **change})
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["code"], "submission_conflict")
                self.assert_pending_and_unspent(signed)
        first = self.create(signed)
        self.assertEqual(first.status_code, 201, first.content)
        for change in changes:
            with self.subTest(recovered_change=change):
                response = self.message({**self.body(), **change})
                self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.recover().json()["order"]["uuid"], first.json()["order"]["uuid"])

    def test_recovery_uses_original_terms_after_order_mutation_and_signature_expiry(self):
        signed = self.signed_body()
        first = self.create(signed)
        self.assertEqual(first.status_code, 201, first.content)
        order_id = first.json()["order"]["uuid"]
        with use_operator():
            TransferOrder.objects.filter(pk=order_id).update(
                quantity=15, price_per_share=Decimal("3.00"), status="cancelled"
            )
            deadline = SigningChallenge.objects.get(digest=signed["digest"]).expires_at
        with patch("tokens.models.signing_challenge.timezone.now", return_value=deadline + timedelta(days=1)):
            recovered = self.create(self.body())
            refreshed = self.message()
        self.assertEqual(recovered.status_code, 200, recovered.content)
        result = recovered.json()
        self.assertEqual(result["order"]["uuid"], order_id)
        self.assertEqual(
            (result["order"]["quantity"], result["order"]["pricePerShare"], result["order"]["status"]),
            (15, "3.00", "cancelled"),
        )
        self.assertEqual((result["intent"]["quantity"], result["intent"]["pricePerShare"]), ("10", "2.50"))
        self.assertEqual(refreshed.json(), result)
        self.assertIsNone(result["challenge"])
        self.assertEqual(len(self.events), 1)

    def test_a_recorded_business_refusal_spends_once_and_remains_refused_when_conditions_improve(self):
        signed = self.signed_body(self.body(order_type="sell"))
        self.balance.get_token_balance.return_value = 0
        first = self.create(signed)
        self.assertEqual(first.status_code, 400, first.content)
        self.assertEqual(first.json()["refusal"]["code"], "insufficient_balance")
        self.balance.get_token_balance.return_value = 100
        replay = self.create(signed)
        self.assertEqual(replay.status_code, 400, replay.content)
        self.assertEqual(first.json(), replay.json())
        self.assertEqual(self.recover().json(), first.json())
        with use_operator():
            self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count)
        self.assertEqual(self.events, [])
        fresh = self.create(self.signed_body(self.body(order_type="sell", submission_id=str(uuid4()))))
        self.assertEqual(fresh.status_code, 201, fresh.content)

    def test_a_lost_unrepresentable_match_refusal_is_permanent_and_a_new_submission_can_succeed(self):
        counter = self.counter_order()
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=0)
            TransferOrder.objects.filter(pk=counter.pk).update(quantity=3, price_per_share=Decimal("1.23"))
            before_counter = TransferOrder.objects.filter(pk=counter.pk).values().get()
            before_swaps = SwapOrder.objects.count()
        body = self.body(quantity=3, price_per_share="1.23")
        signed = self.signed_body(body)
        with patch(
            "tokens.views.trading_order.submission_snapshot", side_effect=RuntimeError("synthetic lost refusal")
        ):
            lost = self.create(signed)
        self.assertEqual(lost.status_code, 500)
        replay = self.create(signed)
        self.assertEqual(replay.status_code, 400, replay.content)
        result = replay.json()
        self.assertEqual(result["status"], "refused")
        self.assertEqual(result["refusal"]["code"], "invalid_settlement_amount")
        self.assertIn("cannot be represented", result["refusal"]["detail"])
        self.assertIsNone(result["order"])
        self.assertIsNone(result["match"])
        self.assertIsNone(result["challenge"])
        with use_operator():
            challenge = SigningChallenge.objects.get(digest=signed["digest"])
            self.assertTrue(challenge.is_consumed)
            self.assertEqual(challenge.consumed_signature, signed["signature"])
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count)
            self.assertEqual(SwapOrder.objects.count(), before_swaps)
            self.assertEqual(TransferOrder.objects.filter(pk=counter.pk).values().get(), before_counter)
            TransferOrder.objects.filter(pk=counter.pk).update(price_per_share=Decimal("1.00"))
        self.assertEqual(self.create(signed).json(), result)
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=2)
        recovered = self.recover()
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json(), result)
        self.assertEqual(self.message(body).json(), result)
        self.assertEqual(self.create(signed).json(), result)
        self.assertEqual(self.create({**signed, "quantity": 2}).status_code, 409)
        self.assertEqual(self.events, [])
        fresh = self.create(self.signed_body({**body, "submission_id": str(uuid4())}))
        self.assertEqual(fresh.status_code, 201, fresh.content)
        with use_operator():
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 1)
            self.assertEqual(SwapOrder.objects.count(), before_swaps + 1)
            swap = SwapOrder.objects.get(pk=fresh.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (3, 300))
            counter.refresh_from_db()
            self.assertEqual(counter.filled_quantity, 3)
        self.assertEqual([event[0] for event in self.events], ["order_created", "order_matched"])
        self.chain.send_raw_transaction.assert_not_called()

    def test_a_payment_beyond_storage_bounds_is_a_durable_refusal(self):
        counter = self.counter_order()
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=18)
            before_counter = TransferOrder.objects.filter(pk=counter.pk).values().get()
            before_swaps = SwapOrder.objects.count()
        signed = self.signed_body()
        refused = self.create(signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "invalid_settlement_amount")
        self.assertEqual(self.recover().json(), refused.json())
        with use_operator():
            self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count)
            self.assertEqual(SwapOrder.objects.count(), before_swaps)
            self.assertEqual(TransferOrder.objects.filter(pk=counter.pk).values().get(), before_counter)
        self.assertEqual(self.events, [])
        self.chain.send_raw_transaction.assert_not_called()

    def test_buy_skips_inexact_partial_fills_and_keeps_price_time_priority(self):
        first = self.counter_order(quantity=100, price="1.23")
        second = self.counter_order(quantity=100, price="1.50", wallet=first.wallet)
        winner = self.counter_order(quantity=3, price="2.00", wallet=first.wallet)
        later = self.counter_order(quantity=3, price="2.00", wallet=first.wallet)
        dearer = self.counter_order(quantity=3, price="2.50", wallet=first.wallet)
        unchanged = [first.pk, second.pk, later.pk, dearer.pk]
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=0)
            before = list(TransferOrder.objects.filter(pk__in=unchanged).order_by("pk").values())
            before_swaps = SwapOrder.objects.count()
        match = token_transfer_service.match_orders
        attempts = []

        def observe(buy, sell, quantity):
            original = [
                {field.attname: getattr(order, field.attname) for field in order._meta.concrete_fields}
                for order in (buy, sell)
            ]
            attempts.append(sell.pk)
            try:
                return match(buy, sell, quantity)
            except InvalidSettlementAmountException:
                self.assertEqual(
                    [
                        {field.attname: getattr(order, field.attname) for field in order._meta.concrete_fields}
                        for order in (buy, sell)
                    ],
                    original,
                )
                self.assertEqual(TransferOrder.objects.filter(pk=sell.pk).values().get(), original[1])
                self.assertEqual(self.events, [])
                raise

        with patch.object(token_transfer_service, "match_orders", side_effect=observe):
            created = self.create(self.signed_body(self.body(quantity=3, price_per_share="3.00")))
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], str(winner.pk))
        self.assertEqual(attempts, [first.pk, second.pk, winner.pk])
        with use_operator():
            self.assertEqual(list(TransferOrder.objects.filter(pk__in=unchanged).order_by("pk").values()), before)
            self.assertEqual(SwapOrder.objects.count(), before_swaps + 1)
            swap = SwapOrder.objects.get(pk=created.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (3, 6))
        self.assertEqual([event[0] for event in self.events], ["order_created", "order_matched"])
        self.chain.send_raw_transaction.assert_not_called()

    def test_sell_skips_an_inexact_partial_fill_and_matches_the_representable_full_lot(self):
        first = self.counter_order(quantity=3, price="2.50", order_type="buy")
        winner = self.counter_order(quantity=100, price="2.25", order_type="buy", wallet=first.wallet)
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=0)
            before = TransferOrder.objects.filter(pk=first.pk).values().get()
        created = self.create(self.signed_body(self.body(order_type="sell", quantity=100, price_per_share="1.23")))
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], str(winner.pk))
        with use_operator():
            self.assertEqual(TransferOrder.objects.filter(pk=first.pk).values().get(), before)
            swap = SwapOrder.objects.get(pk=created.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (100, 123))
        self.assertEqual([event[0] for event in self.events], ["order_created", "order_matched"])

    def test_sell_skips_an_overflowing_fill_without_reducing_its_quantity(self):
        first = self.counter_order(quantity=100, price="2.00", order_type="buy")
        winner = self.counter_order(quantity=3, price="1.00", order_type="buy", wallet=first.wallet)
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=18)
            before = TransferOrder.objects.filter(pk=first.pk).values().get()
        created = self.create(self.signed_body(self.body(order_type="sell", quantity=100, price_per_share="1.00")))
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], str(winner.pk))
        self.assertEqual(created.json()["intent"]["quantity"], "100")
        with use_operator():
            self.assertEqual(TransferOrder.objects.filter(pk=first.pk).values().get(), before)
            swap = SwapOrder.objects.get(pk=created.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (3, 3 * 10**18))

    def test_new_valid_candidate_does_not_reopen_an_original_refused_submission(self):
        first = self.counter_order(quantity=100, price="1.23")
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=0)
            before = TransferOrder.objects.filter(pk=first.pk).values().get()
        body = self.body(quantity=3, price_per_share="2.00")
        signed = self.signed_body(body)
        refused = self.create(signed)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["refusal"]["code"], "invalid_settlement_amount")
        winner = self.counter_order(quantity=3, price="2.00", wallet=first.wallet)
        self.assertEqual(self.create(signed).json(), refused.json())
        self.assertEqual(self.recover().json(), refused.json())
        self.assertEqual(self.events, [])
        created = self.create(self.signed_body({**body, "submission_id": str(uuid4())}))
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], str(winner.pk))
        with use_operator():
            self.assertEqual(TransferOrder.objects.filter(pk=first.pk).values().get(), before)

    def test_non_amount_failure_after_a_skipped_candidate_remains_retryable(self):
        first = self.counter_order(quantity=100, price="1.23")
        winner = self.counter_order(quantity=3, price="2.00", wallet=first.wallet)
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base").update(decimals=0)
            before = list(TransferOrder.objects.filter(pk__in=[first.pk, winner.pk]).order_by("pk").values())
        from tokens.services import atomic_swap_service

        create_swap = atomic_swap_service.create_swap_order
        signed = self.signed_body(self.body(quantity=3, price_per_share="2.00"))
        for error in (
            OrderMatchException(),
            ImproperlyConfigured("synthetic configuration"),
            DatabaseError("synthetic"),
        ):

            def fail_winner(*args, **kwargs):
                if kwargs["sell_order"].pk == winner.pk:
                    raise error
                return create_swap(*args, **kwargs)

            with self.subTest(error=type(error).__name__), patch.object(
                atomic_swap_service, "create_swap_order", side_effect=fail_winner
            ):
                response = self.create(signed)
            if isinstance(error, OrderMatchException):
                self.assertEqual(response.status_code, 400)
            else:
                self.assertGreaterEqual(response.status_code, 500)
            self.assert_pending_and_unspent(signed)
            with use_operator():
                self.assertEqual(
                    list(TransferOrder.objects.filter(pk__in=[first.pk, winner.pk]).order_by("pk").values()), before
                )
        self.assertEqual(self.create(signed).status_code, 201)

    def test_winning_attempt_calculates_and_captures_its_own_deployment_snapshot(self):
        first = self.counter_order(quantity=100, price="1.23")
        winner = self.counter_order(quantity=3, price="2.00", wallet=first.wallet)
        with use_operator():
            deployments = AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin, chain="base")
            deployments.update(decimals=0)
        calls = []

        def resolve(asset):
            with use_operator():
                if calls:
                    deployments.update(decimals=2)
                deployment = require_deployment(asset)
                calls.append(deployment.decimals)
                if len(calls) == 2:
                    deployments.update(decimals=8)
            return deployment

        with patch("tokens.services.atomic_swap_service.require_deployment", side_effect=resolve):
            created = self.create(self.signed_body(self.body(quantity=3, price_per_share="2.00")))
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], str(winner.pk))
        self.assertEqual(calls, [0, 2])
        with use_operator():
            swap = SwapOrder.objects.get(pk=created.json()["match"]["swapOrder"])
            context = recorded_settlement_context(swap)
            self.assertEqual(swap.payment_amount, 600)
            self.assertEqual(context["payment_asset"]["deployment_decimals"], 2)
            self.assertEqual(context["typed_data"]["message"]["paymentAmount"], "600")

    def test_foreign_account_lookup_hides_pending_and_created_outcomes(self):
        signed = self.signed_body()
        with use_operator():
            other = make_tenant("submission-outsider")
        for created in (False, True):
            if created:
                self.client.force_authenticate(self.tenant.user)
                self.assertEqual(self.create(signed).status_code, 201)
            self.client.force_authenticate(other.user)
            foreign = self.recover()
            missing = self.recover(uuid4())
            self.assertEqual(foreign.status_code, 404, foreign.content)
            self.assertEqual(foreign.json(), missing.json())
        self.client.force_authenticate(self.tenant.user)
        self.assertEqual(self.recover().status_code, 200)

    def test_undeployed_token_and_unverified_wallet_do_not_block_authorized_outcome_recovery(self):
        signed = self.signed_body()
        first = self.create(signed)
        self.assertEqual(first.status_code, 201, first.content)
        visible = self.recover()
        self.assertEqual(visible.json()["order"]["tokenSymbol"], self.tenant.deployed_token.symbol)
        with use_operator():
            ShareToken.objects.filter(pk=self.tenant.deployed_token.pk).update(status="failed", contract_address="")
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="PENDING")
        with override_settings(BLOCKCHAIN_CHAIN_ID=settings.BLOCKCHAIN_CHAIN_ID + 1):
            recovered = self.create(self.body())
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json()["order"]["uuid"], first.json()["order"]["uuid"])
        fresh = self.message(self.body(submission_id=str(uuid4())))
        self.assertEqual(fresh.status_code, 400, fresh.content)


class OrderSubmissionRecoveryTest(SubmissionRecoveryChecks, APITransactionTestCase):
    pass


class SubmissionBoundaryChecks:
    def test_a_caller_transaction_is_refused_before_any_spend(self):
        signed = self.signed_body()
        with atomic():
            nested = self.create(signed)
            self.assertEqual(nested.status_code, 503, nested.content)
        self.assert_pending_and_unspent(signed)
        self.whitelist.is_whitelisted.assert_not_called()
        self.assertEqual(self.create(signed).status_code, 201)

    def test_disabled_autocommit_is_refused_before_any_spend(self):
        signed = self.signed_body()
        connection = connections[current_alias()]
        connection.set_autocommit(False)
        try:
            manual = self.create(signed)
            self.assertEqual(manual.status_code, 503, manual.content)
        finally:
            connection.rollback()
            connection.set_autocommit(True)
        self.assert_pending_and_unspent(signed)
        self.whitelist.is_whitelisted.assert_not_called()
        self.assertEqual(self.create(signed).status_code, 201)


class OrderSubmissionProtocolTest(SubmissionBoundaryChecks, SubmissionFixtures, APITransactionTestCase):
    def test_create_challenge_schema_validates_nested_signing_fields(self):
        document = SchemaGenerator().get_schema(request=None, public=True)
        response = self.message(self.body())
        self.assertEqual(response.status_code, 200, response.content)
        challenge = response.json()["challenge"]
        validator = Draft4Validator(
            {"$ref": "#/components/schemas/OrderCreateChallenge"}, resolver=RefResolver.from_schema(document)
        )
        self.assertEqual(list(validator.iter_errors(challenge)), [])
        invalid_domain = deepcopy(challenge)
        del invalid_domain["domain"]["chainId"]
        invalid_types = deepcopy(challenge)
        invalid_types["types"][next(iter(challenge["types"]))][0]["type"] = 1
        invalid_message = deepcopy(challenge)
        invalid_message["message"][next(iter(challenge["message"]))] = {"value": "invalid"}
        for invalid in (invalid_domain, invalid_types, invalid_message):
            with self.subTest(invalid=invalid):
                self.assertFalse(validator.is_valid(invalid))

    def test_create_request_schemas_accept_lossless_integer_strings_and_numeric_drafts(self):
        schema = SchemaGenerator().get_schema(request=None, public=True)
        for path in ("/api/v1/trading/orders/create/message/", "/api/v1/trading/orders/create/"):
            request = schema["paths"][path]["post"]["requestBody"]["content"]["application/json"]["schema"]
            fields = schema["components"]["schemas"][request["$ref"].rsplit("/", 1)[1]]["properties"]
            for name in ("quantity", "minQuantity"):
                with self.subTest(path=path, field=name):
                    validator = Draft4Validator(fields[name])
                    self.assertTrue(validator.is_valid(10))
                    self.assertTrue(validator.is_valid("9007199254740993"))

    def test_identity_fields_are_required_before_any_submission_is_created(self):
        for field in ("submission_id", "owner_account_uuid"):
            body = self.body()
            body.pop(field)
            response = self.message(body)
            self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(OrderSubmission.objects.exists())
        self.issue()
        self.assertEqual(self.submission().status, "pending")

    def test_a_lost_commit_acknowledgement_is_recovered_without_reexecuting(self):
        signed = self.signed_body()
        connection = connections[current_alias()]
        commit = connection.commit

        def commit_then_lose_acknowledgement():
            commit()
            raise DatabaseError("synthetic lost commit acknowledgement")

        with patch.object(connection, "commit", side_effect=commit_then_lose_acknowledgement):
            lost = self.create(signed)
        self.assertEqual(lost.status_code, 503, lost.content)
        recovered = self.recover()
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json()["status"], "created")
        retry = self.create(signed)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json(), recovered.json())
        with use_operator():
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count + 1)
            self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)

    def test_pending_submissions_require_the_original_chain_and_contract(self):
        signed = self.signed_body()
        with override_settings(BLOCKCHAIN_CHAIN_ID=settings.BLOCKCHAIN_CHAIN_ID + 1):
            response = self.create(signed)
        self.assertEqual(response.status_code, 400, response.content)
        self.assert_pending_and_unspent(signed)
        with use_operator():
            ShareToken.objects.filter(pk=self.tenant.deployed_token.pk).update(contract_address="0x" + "ef" * 20)
        self.assertEqual(self.create(signed).status_code, 400)
        self.assert_pending_and_unspent(signed)
        with use_operator():
            ShareToken.objects.filter(pk=self.tenant.deployed_token.pk).update(
                contract_address=self.tenant.deployed_token.contract_address
            )
        self.assertEqual(self.create(signed).status_code, 201)

    def test_the_envelope_and_stored_link_bind_account_wallet_and_submission(self):
        issued = self.issue()
        submission = self.submission()
        for field, value in (
            ("submissionId", str(self.submission_id)),
            ("ownerAccountUuid", str(self.tenant.account.pk)),
            ("walletUuid", str(self.wallet.pk)),
        ):
            self.assertEqual(issued["message"][field], value)
            self.assertIn(field, [entry["name"] for entry in issued["types"]["OrderCreate"]])
        with use_operator():
            challenge = SigningChallenge.objects.get(digest=issued["digest"])
        self.assertEqual(challenge.submission_id, submission.pk)
        self.assertEqual(submission.initiated_by_id, self.tenant.user.pk)

    def test_a_signature_for_one_submission_cannot_create_another(self):
        first = self.signed_body()
        second = self.signed_body(self.body(submission_id=str(uuid4())))
        response = self.create({**second, "digest": first["digest"], "signature": first["signature"]})
        self.assertEqual(response.status_code, 400, response.content)
        self.assert_pending_and_unspent(first)
        self.assert_pending_and_unspent(second)
        self.assertEqual(self.create(first).status_code, 201)

    def test_invalid_and_expired_signatures_cannot_create_a_pending_order(self):
        bad = self.signed_body(signer=OTHER_KEY)
        invalid = self.create(bad)
        self.assertEqual(invalid.status_code, 403, invalid.content)
        self.assert_pending_and_unspent(bad)
        valid = self.signed_body()
        with use_operator():
            deadline = SigningChallenge.objects.get(digest=valid["digest"]).expires_at
        with patch("tokens.models.signing_challenge.timezone.now", return_value=deadline + timedelta(seconds=1)):
            expired = self.create(valid)
        self.assertEqual(expired.status_code, 400, expired.content)
        self.assertEqual(expired.json()["code"], "challenge_expired")
        self.assert_pending_and_unspent(valid)
        fresh = self.signed_body()
        self.assertEqual(self.create(fresh).status_code, 201)

    def test_create_cannot_invent_a_submission_or_skip_a_pending_signature(self):
        absent = self.create(self.body(digest="0x" + "ab" * 32, signature="0x" + "cd" * 65))
        self.assertEqual(absent.status_code, 404, absent.content)
        signed = self.signed_body()
        missing = self.create(self.body())
        self.assertEqual(missing.status_code, 400, missing.content)
        self.assert_pending_and_unspent(signed)
        self.assertEqual(self.create(signed).status_code, 201)

    def test_legacy_keyless_challenges_are_not_rewritten_or_spent(self):
        issued = self.issue()
        legacy = deepcopy(issued)
        for name in ("submissionId", "ownerAccountUuid", "walletUuid"):
            legacy["message"].pop(name)
        legacy["types"]["OrderCreate"] = [
            entry
            for entry in legacy["types"]["OrderCreate"]
            if entry["name"] not in {"submissionId", "ownerAccountUuid", "walletUuid"}
        ]
        legacy["message"]["nonce"] = str(int(legacy["message"]["nonce"]) + 1)
        digest = typed_data_digest(legacy["domain"], legacy["types"], legacy["message"])
        with use_operator():
            challenge = SigningChallenge.objects.create(
                purpose=SigningChallengePurpose.ORDER_CREATE,
                wallet=self.wallet,
                wallet_address=self.wallet.address,
                chain_id=legacy["domain"]["chainId"],
                verifying_contract=legacy["domain"]["verifyingContract"],
                payload={key: legacy[key] for key in ("domain", "types", "message")},
                digest=digest,
                nonce=int(legacy["message"]["nonce"]),
                expires_at=timezone.now() + timedelta(minutes=5),
            )
            original = challenge.payload
        signature = OWNER.sign_message(
            signable_message(legacy["domain"], legacy["types"], legacy["message"])
        ).signature.to_0x_hex()
        old_request = self.body(digest=digest, signature=signature)
        old_request.pop("submission_id")
        old_request.pop("owner_account_uuid")
        old_response = self.create(old_request)
        self.assertEqual(old_response.status_code, 400, old_response.content)
        self.assertIn("submissionId", old_response.json())
        self.assertIn("ownerAccountUuid", old_response.json())
        self.assertNotIn("code", old_response.json())
        response = self.create(self.body(digest=digest, signature=signature))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "submission_refresh_required")
        with use_operator():
            challenge.refresh_from_db()
            self.assertIsNone(challenge.submission_id)
            self.assertFalse(challenge.is_consumed)
            self.assertEqual(challenge.payload, original)

    def test_infrastructure_and_unclassified_business_errors_remain_retryable(self):
        signed = self.signed_body(self.body(order_type="sell"))
        for error in (
            ConnectionError("synthetic provider"),
            TokenBalanceRetrievalException(),
            ImproperlyConfigured("synthetic configuration"),
            DatabaseError("synthetic database"),
        ):
            with self.subTest(error=type(error).__name__):
                self.balance.get_token_balance.side_effect = error
                response = self.create(signed)
                self.assertGreaterEqual(response.status_code, 500, response.content)
                self.assert_pending_and_unspent(signed)
        self.balance.get_token_balance.side_effect = None
        for error in (OrderMatchException(), InsufficientBalanceException()):
            with self.subTest(unclassified=type(error).__name__), patch.object(
                token_transfer_service, "find_matching_orders", side_effect=error
            ):
                response = self.create(signed)
                self.assertEqual(response.status_code, 400, response.content)
                self.assert_pending_and_unspent(signed)
        self.assertEqual(self.create(signed).status_code, 201)

    def test_refusal_rolls_back_the_creation_savepoint_before_committing_the_spend(self):
        signed = self.signed_body()
        with patch.object(
            token_transfer_service, "find_matching_orders", side_effect=CreateOrderNotWhitelistedException()
        ):
            response = self.create(signed)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["status"], "refused")
        with use_operator():
            self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
            self.assertEqual(TransferOrder.objects.count(), self.initial_order_count)
        self.assertEqual(self.events, [])

    def test_a_successful_negative_whitelist_observation_records_the_refusal(self):
        signed = self.signed_body()
        self.whitelist.is_whitelisted.return_value = False
        response = self.create(signed)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["refusal"]["code"], "not_whitelisted")
        with use_operator():
            self.assertTrue(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
        self.whitelist.is_whitelisted.return_value = True
        self.assertEqual(self.create(signed).json(), response.json())

    def test_wallet_reassignment_or_address_change_prevents_recovery(self):
        signed = self.signed_body()
        first = self.create(signed)
        self.assertEqual(first.status_code, 201, first.content)
        with use_operator():
            other = make_tenant("submission-wallet-owner")
            Wallet.objects.filter(pk=self.wallet.pk).update(user_account=other.account)
        self.assertEqual(self.recover().status_code, 404)
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(user_account=self.tenant.account, address=OTHER_KEY.address)
        self.assertEqual(self.recover().status_code, 404)
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(address=OWNER.address)
        self.assertEqual(self.recover().json(), first.json())

    def test_token_display_edits_do_not_change_original_intent(self):
        signed = self.signed_body()
        with use_operator():
            ShareToken.objects.filter(pk=self.tenant.deployed_token.pk).update(name="New displayed name", symbol="NEW")
        response = self.create(signed)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["order"]["tokenSymbol"], "NEW")
        self.assertEqual(self.submission().token_metadata["symbol"], self.tenant.deployed_token.symbol)


class ScopedOrderSubmissionRecoveryTest(
    RunsOnTheScopedConnection, SubmissionBoundaryChecks, SubmissionRecoveryChecks, APITransactionTestCase
):
    def test_raw_submission_reads_and_writes_follow_current_account_membership(self):
        self.issue()
        own = self.submission()
        with use_operator():
            other = make_tenant("submission-policy")
            foreign = pending_submission(other)
        with acting_for(self.tenant.user.pk):
            self.assertTrue(OrderSubmission.objects.filter(pk=own.pk).exists())
            self.assertFalse(OrderSubmission.objects.filter(pk=foreign.pk).exists())
            self.assertEqual(OrderSubmission.objects.filter(pk=foreign.pk).update(updated_at=timezone.now()), 0)
            self.assertEqual(OrderSubmission.objects.filter(pk=own.pk).update(updated_at=timezone.now()), 1)
            with self.assertRaises(DatabaseError), atomic():
                pending_submission(other)
        with use_operator():
            self.assertTrue(OrderSubmission.objects.filter(pk=foreign.pk).exists())

    def test_hidden_foreign_issuer_metadata_falls_back_without_widening_token_visibility(self):
        with use_operator():
            issuer = make_tenant("submission-issuer")
        body = self.body(token=str(issuer.deployed_token.pk))
        signed = self.signed_body(body)
        created = self.create(signed)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(self.recover().json()["order"]["tokenName"], issuer.deployed_token.name)
        with acting_for(self.tenant.user.pk):
            self.assertTrue(ShareToken.objects.filter(pk=issuer.deployed_token.pk).exists())
        with use_operator():
            ShareToken.objects.filter(pk=issuer.deployed_token.pk).update(
                status="failed", name="No longer visible", symbol="HID"
            )
        with acting_for(self.tenant.user.pk):
            self.assertFalse(ShareToken.objects.filter(pk=issuer.deployed_token.pk).exists())
        recovered = self.recover()
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json()["order"]["tokenName"], issuer.deployed_token.name)
        self.assertEqual(recovered.json()["order"]["uuid"], created.json()["order"]["uuid"])
        self.client.force_authenticate(issuer.user)
        self.assertEqual(self.recover().status_code, 404)
