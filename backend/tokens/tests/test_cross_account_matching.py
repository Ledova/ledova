import signal
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Queue
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connections
from django.db.models.signals import post_init
from rest_framework.test import APITransactionTestCase

from assets.models import AssetChainDeployment
from companies.models import Company
from shared.db import atomic, configured, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_eligible, make_tenant
from shared.utils.typed_data import signable_message
from tokens.models import ShareToken, SigningChallenge, SwapOrder, TransferOrder
from tokens.services import token_transfer_service
from tokens.tests.order_process_fixtures import OrderChild, wait_for_row_lock
from tokens.tests.order_submission_fixtures import (
    BASE,
    COUNTERPARTY,
    OTHER_KEY,
    OWNER,
    SubmissionFixtures,
)
from wallets.models import Wallet


class CrossAccountMatchingFixtures(SubmissionFixtures):
    def setUp(self):
        super().setUp()
        self.patch("tokens.services.order_modification_service.share_token_service", new=self.balance)
        with use_operator():
            self.buyer = make_tenant("matching-buyer", with_swap=False)
            make_eligible(self.tenant)
            make_eligible(self.buyer)
            Company.objects.filter(pk=self.tenant.company.pk).update(status="active", is_open_to_investors=True)
            self.buyer_wallet = Wallet.objects.create(
                user_account=self.buyer.account,
                address=COUNTERPARTY.address,
                chain="base",
                verification_status="VERIFIED",
            )

    def seller_order(self, **terms):
        self.client.force_authenticate(self.tenant.user)
        signed = self.signed_body(self.body(order_type="sell", **terms), signer=OWNER)
        response = self.create(signed)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["order"]["uuid"]

    def buyer_intent(self, *, buyer=None, wallet=None, signer=COUNTERPARTY, price="2.50", quantity=10):
        buyer = buyer or self.buyer
        wallet = wallet or self.buyer_wallet
        self.client.force_authenticate(buyer.user)
        return self.signed_body(
            self.body(
                submission_id=str(uuid4()),
                owner_account_uuid=str(buyer.account.pk),
                wallet_uuid=str(wallet.pk),
                wallet_address=wallet.address,
                price_per_share=price,
                quantity=quantity,
            ),
            signer=signer,
        )


class CrossAccountMatchingChecks(CrossAccountMatchingFixtures):
    def assert_market_quotes(self, *, bid="1.00", ask="2.50", quantity=10):
        self.client.force_authenticate(self.buyer.user)
        token_id = str(self.tenant.deployed_token.pk)
        for path in ("/api/v1/trading/tokens/", "/api/v1/directory/tokens/"):
            for endpoint in (path, f"{path}{token_id}/"):
                response = self.client.get(endpoint)
                self.assertEqual(response.status_code, 200, response.content)
                body = response.json()
                row = next(row for row in body["results"] if row["uuid"] == token_id) if endpoint == path else body
                self.assertEqual((row["bestBid"], row["bestAsk"]), (bid, ask), endpoint)
        market = self.client.get(f"/api/v1/trading/tokens/{token_id}/market-data/")
        self.assertEqual(market.status_code, 200, market.content)
        self.assertEqual((market.json()["bestBid"], market.json()["bestAsk"]), (bid, ask))
        book = self.client.get(f"/api/v1/trading/tokens/{token_id}/order-book/")
        self.assertEqual(book.status_code, 200, book.content)
        self.assertEqual(book.json()["buyOrders"], [] if bid is None else [{"price": bid, "quantity": 10, "orders": 1}])
        self.assertEqual(
            book.json()["sellOrders"], [] if ask is None else [{"price": ask, "quantity": quantity, "orders": 1}]
        )

    def resting_market(self):
        seller_id = self.seller_order()
        buy = self.create(self.buyer_intent(price="1.00"))
        self.assertEqual(buy.status_code, 201, buy.content)
        self.assertIsNone(buy.json()["match"])
        self.assert_market_quotes()
        return seller_id

    def test_market_quotes_exclude_a_deverified_wallet(self):
        self.resting_market()
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="PENDING")
        self.assert_market_quotes(ask=None)

    def test_market_quotes_exclude_a_non_evm_wallet(self):
        self.resting_market()
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(chain="bitcoin")
        self.assert_market_quotes(ask=None)

    def test_market_quotes_exclude_an_owner_who_deleted_their_account(self):
        self.resting_market()
        self.client.force_authenticate(self.tenant.user)
        deleted = self.client.post("/api/user-profiles/delete-account/")
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assert_market_quotes(ask=None)

    def test_market_quotes_exclude_orders_without_signed_admission(self):
        self.resting_market()
        with use_operator():
            TransferOrder.objects.create(
                token=self.tenant.deployed_token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type="sell",
                quantity=20,
                price_per_share="0.50",
            )
        self.assert_market_quotes()

    def test_market_quotes_exclude_orders_from_a_different_chain(self):
        self.resting_market()
        with self.settings(BLOCKCHAIN_CHAIN_ID=settings.BLOCKCHAIN_CHAIN_ID + 1):
            self.assert_market_quotes(bid=None, ask=None)
        self.assert_market_quotes()

    def test_market_quotes_exclude_orders_from_a_replaced_contract(self):
        self.resting_market()
        with use_operator():
            ShareToken.objects.filter(pk=self.tenant.deployed_token.pk).update(contract_address="0x" + "af" * 20)
        self.assert_market_quotes(bid=None, ask=None)

    def test_market_quotes_include_only_the_remaining_partial_quantity(self):
        seller_id = self.resting_market()
        with use_operator():
            TransferOrder.objects.filter(pk=seller_id).update(status="partially_filled", filled_quantity=3)
        self.assert_market_quotes(quantity=7)

    def test_market_quotes_exclude_exhausted_or_below_minimum_remainders(self):
        seller_id = self.resting_market()
        for filled, minimum in ((10, 0), (3, 8)):
            with self.subTest(filled=filled, minimum=minimum), use_operator():
                TransferOrder.objects.filter(pk=seller_id).update(
                    status="partially_filled", filled_quantity=filled, min_quantity=minimum
                )
            self.assert_market_quotes(ask=None)

    def test_a_successful_match_does_not_materialize_later_candidates(self):
        candidates = [
            self.seller_order(submission_id=str(uuid4()), price_per_share=price) for price in ("1.00", "2.00", "3.00")
        ]
        signed = self.buyer_intent(price="3.00")
        observed = set()

        def record_candidate(sender, instance, **kwargs):
            if str(instance.pk) in candidates:
                observed.add(str(instance.pk))

        post_init.connect(record_candidate, sender=TransferOrder)
        try:
            created = self.create(signed)
        finally:
            post_init.disconnect(record_candidate, sender=TransferOrder)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], candidates[0])
        self.assertEqual(observed, {candidates[0]})

    def stale_foreign_wallet_is_not_matched(self, **changes):
        seller_id = self.seller_order()
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(**changes)
        created = self.create(self.buyer_intent())
        self.assertEqual(created.status_code, 201, created.content)
        self.assertIsNone(created.json()["match"])
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 0)

    def test_a_deverified_foreign_wallet_is_not_matched(self):
        self.stale_foreign_wallet_is_not_matched(verification_status="PENDING")

    def test_a_foreign_wallet_changed_to_a_non_evm_chain_is_not_matched(self):
        self.stale_foreign_wallet_is_not_matched(chain="bitcoin")

    def test_a_foreign_owner_who_deleted_their_account_is_not_matched(self):
        seller_id = self.seller_order()
        deleted = self.client.post("/api/user-profiles/delete-account/")
        self.assertEqual(deleted.status_code, 200, deleted.content)
        created = self.create(self.buyer_intent())
        self.assertEqual(created.status_code, 201, created.content)
        self.assertIsNone(created.json()["match"])
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 0)
            self.wallet.refresh_from_db()
            self.assertEqual(self.wallet.verification_status, "VERIFIED")

    def test_a_later_sell_matches_the_other_accounts_signed_buy(self):
        buy = self.create(self.buyer_intent())
        self.assertEqual(buy.status_code, 201, buy.content)
        self.assertIsNone(buy.json()["match"])
        seller_id = self.seller_order()
        recovered = self.recover()
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json()["match"]["counterOrder"], buy.json()["order"]["uuid"])
        with use_operator():
            swap = SwapOrder.objects.get(pk=recovered.json()["match"]["swapOrder"])
            self.assertEqual(str(swap.sell_order_id), seller_id)
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, 2500))

    def test_sequential_signed_orders_match_across_accounts_and_recover_the_same_result(self):
        seller_id = self.seller_order()
        signed = self.buyer_intent()
        book = self.client.get(f"/api/v1/trading/tokens/{self.tenant.deployed_token.pk}/order-book/")
        self.assertEqual(book.status_code, 200, book.content)
        self.assertEqual(book.json()["sellOrders"], [{"price": "2.50", "quantity": 10, "orders": 1}])
        created = self.create(signed)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertIsNotNone(created.json()["match"])
        self.assertEqual(created.json()["match"]["counterOrder"], seller_id)
        self.assertEqual(created.json()["order"]["matchedOrderUuid"], seller_id)
        self.assertEqual(self.create(signed).json(), created.json())
        recovered = self.recover(signed["submission_id"], self.buyer.account.pk)
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json(), created.json())
        with use_operator():
            swap = SwapOrder.objects.get(pk=created.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, 2500))
            self.assertEqual(swap.seller_wallet_id, self.wallet.pk)
            self.assertEqual(swap.buyer_wallet_id, self.buyer_wallet.pk)
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 10)

    def test_matching_does_not_expose_the_other_accounts_order_or_submission(self):
        seller_id = self.seller_order()
        created = self.create(self.buyer_intent())
        self.assertIsNotNone(created.json()["match"])
        self.assertEqual(self.client.get(f"{BASE}{seller_id}/").status_code, 404)
        own = self.client.get(f"{BASE}{created.json()['order']['uuid']}/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual(own.json()["matchedOrderUuid"], seller_id)
        listed = self.client.get(BASE)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertNotIn(seller_id, [order["uuid"] for order in listed.json()["results"]])
        self.assertEqual(self.recover().status_code, 404)
        forged = self.message(self.body(submission_id=str(uuid4())))
        self.assertEqual(forged.status_code, 400, forged.content)

    def test_create_and_match_share_one_operator_transaction_and_restore_app_authority(self):
        self.seller_order()
        signed = self.buyer_intent()
        original = token_transfer_service.create_order_and_match
        observations = []

        def observed(*args, **kwargs):
            alias = current_alias()
            observations.append((alias, connections[alias].in_atomic_block))
            return original(*args, **kwargs)

        with patch.object(token_transfer_service, "create_order_and_match", observed):
            response = self.create(signed)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(observations, [(configured("operator"), True)])
        self.assertEqual(current_alias(), configured("app"))
        self.assertFalse(connections[current_alias()].in_atomic_block)

    def test_a_failure_after_matching_rolls_back_both_accounts_and_can_retry_once(self):
        seller_id = self.seller_order()
        signed = self.buyer_intent()
        original = token_transfer_service.create_order_and_match
        with use_operator():
            before = (TransferOrder.objects.count(), SwapOrder.objects.count())

        def fail_after_matching(*args, **kwargs):
            _, match = original(*args, **kwargs)
            self.assertIsNotNone(match)
            raise RuntimeError("Synthetic post-match failure")

        with patch.object(token_transfer_service, "create_order_and_match", fail_after_matching):
            failed = self.create(signed)
        self.assertEqual(failed.status_code, 500, failed.content)
        self.assertEqual(current_alias(), configured("app"))
        with use_operator():
            self.assertEqual((TransferOrder.objects.count(), SwapOrder.objects.count()), before)
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 0)
            self.assertFalse(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed)
        pending = self.recover(signed["submission_id"], self.buyer.account.pk)
        self.assertEqual(pending.json()["status"], "pending")
        created = self.create(signed)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["match"]["counterOrder"], seller_id)
        self.assertEqual(self.create(signed).status_code, 200)

    def test_an_unjournaled_foreign_order_does_not_gain_matching_authority(self):
        with use_operator():
            raw = TransferOrder.objects.create(
                token=self.tenant.deployed_token,
                payment_asset=self.tenant.refs.stablecoin,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type="sell",
                quantity=10,
                price_per_share="2.50",
            )
        created = self.create(self.buyer_intent())
        self.assertEqual(created.status_code, 201, created.content)
        self.assertIsNone(created.json()["match"])
        with use_operator():
            raw.refresh_from_db()
            self.assertEqual(raw.filled_quantity, 0)


class CrossAccountMatchingTest(CrossAccountMatchingChecks, APITransactionTestCase):
    pass


class ScopedCrossAccountMatchingTest(RunsOnTheScopedConnection, CrossAccountMatchingChecks, APITransactionTestCase):
    pass


class CrossAccountMatchingProcessChecks(CrossAccountMatchingFixtures):
    def another_seller_order(self, **terms):
        with use_operator():
            unused_wallet = Wallet.objects.create(
                user_account=self.tenant.account,
                address=OTHER_KEY.address,
                chain="base",
                verification_status="VERIFIED",
            )
        self.client.force_authenticate(self.tenant.user)
        unused = self.create(
            self.signed_body(
                self.body(
                    submission_id=str(uuid4()),
                    wallet_uuid=str(unused_wallet.pk),
                    wallet_address=unused_wallet.address,
                    order_type="sell",
                    **terms,
                ),
                signer=OTHER_KEY,
            )
        )
        self.assertEqual(unused.status_code, 201, unused.content)
        return unused_wallet, unused.json()["order"]["uuid"]

    def assert_an_unused_busy_wallet_does_not_block_matching(self, *, order_row=False, **terms):
        unused_wallet, unused_id = self.another_seller_order(**terms)
        seller_id = self.seller_order()
        signed = self.buyer_intent(price="3.00")
        with tempfile.TemporaryDirectory(prefix="cross-account-unrelated-wallet-") as temporary:
            with use_operator(), atomic():
                if order_row:
                    TransferOrder.objects.filter(pk=unused_id).update(price_per_share=terms["price_per_share"])
                else:
                    Wallet.objects.filter(pk=unused_wallet.pk).update(verification_status="VERIFIED")
                matcher = OrderChild(
                    self,
                    "order_submission_worker",
                    "compete",
                    Path(temporary),
                    body=signed,
                    user_id=self.buyer.user.pk,
                    short_lock_timeout=True,
                )
                self.assertEqual(matcher.read()["stage"], "selecting")
                response = matcher.read()
                self.assertEqual(matcher.wait(), 0, matcher.error_output())
        self.assertEqual(response["status"], 201, response)
        self.assertEqual(response["body"]["match"]["counterOrder"], seller_id)
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=unused_id).filled_quantity, 0)

    def test_a_busy_lower_priority_wallet_does_not_block_the_best_match(self):
        self.assert_an_unused_busy_wallet_does_not_block_matching(price_per_share="3.00")

    def test_a_busy_minimum_incompatible_wallet_does_not_block_a_compatible_match(self):
        self.assert_an_unused_busy_wallet_does_not_block_matching(price_per_share="2.00", quantity=20, min_quantity=20)

    def test_a_busy_lower_priority_order_does_not_block_the_best_match(self):
        self.assert_an_unused_busy_wallet_does_not_block_matching(order_row=True, price_per_share="3.00")

    def test_a_busy_minimum_incompatible_order_does_not_block_a_compatible_match(self):
        self.assert_an_unused_busy_wallet_does_not_block_matching(
            order_row=True, price_per_share="2.00", quantity=20, min_quantity=20
        )

    def assert_busy_submission_is_pending(self, signed, response):
        self.assertEqual(response["status"], 503, response)
        self.assertEqual(response["body"]["code"], "order_matching_busy")
        recovered = self.recover(signed["submission_id"], signed["owner_account_uuid"])
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json()["status"], "pending")
        self.assertIsNone(recovered.json()["order"])
        self.assertIsNone(recovered.json()["match"])
        with use_operator():
            self.assertIsNone(SigningChallenge.objects.get(digest=signed["digest"]).consumed_at)
            self.assertFalse(TransferOrder.objects.filter(wallet_id=signed["wallet_uuid"]).exists())

    def test_a_busy_selected_order_is_retryable_without_spend_then_matches_once(self):
        seller_id = self.seller_order()
        signed = self.buyer_intent()
        with tempfile.TemporaryDirectory(prefix="cross-account-selected-order-") as temporary:
            with use_operator(), atomic():
                TransferOrder.objects.filter(pk=seller_id).update(price_per_share="2.50")
                matcher = OrderChild(
                    self,
                    "order_submission_worker",
                    "compete",
                    Path(temporary),
                    body=signed,
                    user_id=self.buyer.user.pk,
                    short_lock_timeout=True,
                )
                self.assertEqual(matcher.read()["stage"], "selecting")
                response = matcher.read()
                self.assertEqual(matcher.wait(), 0, matcher.error_output())
        self.assert_busy_submission_is_pending(signed, response)
        matched = self.create(signed)
        self.assertEqual(matched.status_code, 201, matched.content)
        self.assertEqual(matched.json()["match"]["counterOrder"], seller_id)
        self.assertEqual(self.create(signed).json(), matched.json())

    def test_changed_candidate_terms_retry_the_same_submission_against_the_new_price(self):
        seller_id = self.seller_order()
        action = self.seller_action(seller_id, "modify")
        signed = self.buyer_intent(price="3.00")
        with tempfile.TemporaryDirectory(prefix="cross-account-changed-candidate-") as temporary:
            matcher = OrderChild(
                self,
                "order_submission_worker",
                "candidate-selected",
                Path(temporary),
                body=signed,
                user_id=self.buyer.user.pk,
            )
            self.assertEqual(matcher.read()["stage"], "candidate-selected")
            self.client.force_authenticate(self.tenant.user)
            modified = self.client.post(f"{BASE}{seller_id}/modify/", action, format="json")
            self.assertEqual(modified.status_code, 200, modified.content)
            matcher.release()
            response = matcher.read()
            self.assertEqual(matcher.wait(), 0, matcher.error_output())
        self.client.force_authenticate(self.buyer.user)
        self.assert_busy_submission_is_pending(signed, response)
        matched = self.create(signed)
        self.assertEqual(matched.status_code, 201, matched.content)
        with use_operator():
            swap = SwapOrder.objects.get(pk=matched.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, 3000))

    def test_an_amount_refused_candidate_releases_its_locks_before_the_fallback(self):
        with use_operator():
            AssetChainDeployment.objects.filter(asset=self.tenant.refs.stablecoin).update(decimals=0)
        seller_id = self.seller_order(quantity=1)
        _, fallback_id = self.another_seller_order(quantity=1, price_per_share="3.00")
        signed = self.buyer_intent(price="3.00", quantity=1)
        with tempfile.TemporaryDirectory(prefix="cross-account-candidate-release-") as temporary:
            matcher = OrderChild(
                self,
                "order_submission_worker",
                "fallback",
                Path(temporary),
                body=signed,
                user_id=self.buyer.user.pk,
            )
            self.assertEqual(matcher.read()["stage"], "fallback")
            try:
                with use_operator(), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '1s'")
                    self.assertEqual(TransferOrder.objects.filter(pk=seller_id).update(price_per_share="2.50"), 1)
                    self.assertEqual(Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="VERIFIED"), 1)
                    self.assertEqual(get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_active=True), 1)
            finally:
                matcher.release()
            response = matcher.read()
            self.assertEqual(matcher.wait(), 0, matcher.error_output())
        self.assertEqual(response["status"], 201, response)
        self.assertEqual(response["body"]["match"]["counterOrder"], fallback_id)
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 0)
            self.assertEqual(SwapOrder.objects.get(pk=response["body"]["match"]["swapOrder"]).payment_amount, 3)

    def crash_and_recover(self, phase):
        seller_id = self.seller_order()
        signed = self.buyer_intent()
        with use_operator():
            before = SwapOrder.objects.count()
        with tempfile.TemporaryDirectory(prefix="cross-account-crash-") as temporary:
            child = OrderChild(
                self, "order_submission_worker", phase, Path(temporary), body=signed, user_id=self.buyer.user.pk
            )
            self.assertEqual(child.wait(), -signal.SIGKILL, child.error_output())
        recovered = self.recover(signed["submission_id"], self.buyer.account.pk)
        self.assertEqual(recovered.status_code, 200, recovered.content)
        committed = phase == "committed"
        self.assertEqual(recovered.json()["status"], "created" if committed else "pending")
        with use_operator():
            self.assertEqual(SigningChallenge.objects.get(digest=signed["digest"]).is_consumed, committed)
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 10 if committed else 0)
            self.assertEqual(SwapOrder.objects.count(), before + int(committed))
        retried = self.create(signed)
        self.assertEqual(retried.status_code, 200 if committed else 201, retried.content)
        self.assertEqual(retried.json()["match"]["counterOrder"], seller_id)
        self.assertEqual(self.create(signed).status_code, 200)
        with use_operator():
            self.assertEqual(SwapOrder.objects.count(), before + 1)

    def test_process_death_after_spend_leaves_both_accounts_unmatched(self):
        self.crash_and_recover("spent")

    def test_process_death_after_matching_rolls_back_both_accounts(self):
        self.crash_and_recover("matched")

    def test_process_death_after_commit_recovers_one_cross_account_match(self):
        self.crash_and_recover("committed")

    def test_a_competing_buyer_retries_the_same_submission_after_the_first_matches(self):
        seller_id = self.seller_order()
        first = self.buyer_intent()
        with use_operator():
            third = make_tenant("matching-third", with_swap=False)
            make_eligible(third)
            third_wallet = Wallet.objects.create(
                user_account=third.account,
                address=OTHER_KEY.address,
                chain="base",
                verification_status="VERIFIED",
            )
        second = self.buyer_intent(buyer=third, wallet=third_wallet, signer=OTHER_KEY)
        with tempfile.TemporaryDirectory(prefix="cross-account-buyers-") as temporary:
            directory = Path(temporary)
            one = OrderChild(
                self, "order_submission_worker", "candidates", directory, body=first, user_id=self.buyer.user.pk
            )
            holding = one.read()
            self.assertEqual(holding["stage"], "candidates-locked")
            two = OrderChild(self, "order_submission_worker", "compete", directory, body=second, user_id=third.user.pk)
            self.assertEqual(two.read()["stage"], "selecting")
            busy = two.read()
            self.assertEqual(two.wait(), 0, two.error_output())
            self.assert_busy_submission_is_pending(second, busy)
            one.release()
            matched = one.read()
            self.assertEqual(one.wait(), 0, one.error_output())
        retried = self.create(second)
        self.assertEqual((matched["status"], retried.status_code), (201, 201), retried.content)
        self.assertEqual(matched["body"]["match"]["counterOrder"], seller_id)
        self.assertIsNone(retried.json()["match"])
        self.assertEqual(self.create(second).json(), retried.json())
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 10)
            self.assertEqual(SwapOrder.objects.filter(sell_order_id=seller_id).count(), 1)

    def seller_action(self, seller_id, purpose):
        self.client.force_authenticate(self.tenant.user)
        identity = {"action_id": str(uuid4()), "owner_account_uuid": str(self.tenant.account.pk)}
        terms = (
            {"new_quantity": "12", "new_min_quantity": "0", "new_price_per_share": "3.00"}
            if purpose == "modify"
            else {}
        )
        message = self.client.post(f"{BASE}{seller_id}/{purpose}/message/", identity | terms, format="json")
        self.assertEqual(message.status_code, 200, message.content)
        challenge = message.json()["challenge"]
        return identity | {
            "digest": challenge["digest"],
            "signature": OWNER.sign_message(
                signable_message(challenge["domain"], challenge["types"], challenge["message"])
            ).signature.to_0x_hex(),
        }

    def foreign_action_waits_for_matching(self, purpose):
        seller_id = self.seller_order()
        signed_action = self.seller_action(seller_id, purpose)
        signed_buy = self.buyer_intent()
        with tempfile.TemporaryDirectory(prefix="cross-account-action-") as temporary:
            directory = Path(temporary)
            matcher = OrderChild(
                self, "order_submission_worker", "candidates", directory, body=signed_buy, user_id=self.buyer.user.pk
            )
            holding = matcher.read()
            action = OrderChild(
                self,
                "order_action_worker",
                "compete",
                directory,
                body=signed_action,
                order_id=seller_id,
                endpoint=purpose,
            )
            waiting = action.read()
            wait_for_row_lock(self, waiting["pid"], "wallets", holding["pid"])
            matcher.release()
            matched, refused = matcher.read(), action.read()
            self.assertEqual((matcher.wait(), action.wait()), (0, 0), (matcher.error_output(), action.error_output()))
            action_error = action.error_output()
        self.assertEqual(matched["status"], 201, matched)
        self.assertEqual(refused["status"], 400 if purpose == "cancel" else 409, (refused, action_error))
        self.assertEqual(refused["body"]["status"], "refused")
        self.assertEqual(
            refused["body"]["refusal"]["code"],
            "order_cancellation_failed" if purpose == "cancel" else "order_modification_conflict",
        )
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 10)

    def test_the_foreign_sellers_cancel_waits_for_matching_and_is_refused(self):
        self.foreign_action_waits_for_matching("cancel")

    def test_the_foreign_sellers_modify_waits_for_matching_and_is_refused(self):
        self.foreign_action_waits_for_matching("modify")

    def test_a_busy_foreign_modification_leaves_the_submission_retryable_with_no_spend(self):
        seller_id = self.seller_order()
        signed_action = self.seller_action(seller_id, "modify")
        signed_buy = self.buyer_intent(price="3.00")
        with tempfile.TemporaryDirectory(prefix="cross-account-modify-") as temporary:
            directory = Path(temporary)
            action = OrderChild(
                self,
                "order_action_worker",
                "order-locked",
                directory,
                body=signed_action,
                order_id=seller_id,
                endpoint="modify",
            )
            self.assertEqual(action.read()["stage"], "order-locked")
            matcher = OrderChild(
                self, "order_submission_worker", "compete", directory, body=signed_buy, user_id=self.buyer.user.pk
            )
            self.assertEqual(matcher.read()["stage"], "selecting")
            busy = matcher.read()
            self.assertEqual(matcher.wait(), 0, matcher.error_output())
            self.assert_busy_submission_is_pending(signed_buy, busy)
            with use_operator():
                self.assertFalse(SwapOrder.objects.filter(sell_order_id=seller_id).exists())
            action.release()
            applied = action.read()
            self.assertEqual(action.wait(), 0, action.error_output())
        matched = self.create(signed_buy)
        self.assertEqual((applied["status"], matched.status_code), (200, 201), matched.content)
        self.assertEqual(self.create(signed_buy).json(), matched.json())
        with use_operator():
            swap = SwapOrder.objects.get(pk=matched.json()["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, 3000))
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).modification_count, 1)
            self.assertEqual(SwapOrder.objects.filter(sell_order_id=seller_id).count(), 1)

    def assert_foreign_authority_change_waits_for_matching(self, change, table):
        seller_id = self.seller_order()
        signed_buy = self.buyer_intent()
        connected = Queue()

        def change_authority():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        connected.put(cursor.fetchone()[0])
                    return change()
            finally:
                connections.close_all()

        with tempfile.TemporaryDirectory(prefix="cross-account-verification-") as temporary:
            matcher = OrderChild(
                self,
                "order_submission_worker",
                "candidates",
                Path(temporary),
                body=signed_buy,
                user_id=self.buyer.user.pk,
            )
            holding = matcher.read()
            with ThreadPoolExecutor(1) as pool:
                changing = pool.submit(change_authority)
                try:
                    wait_for_row_lock(self, connected.get(timeout=5), table, holding["pid"])
                finally:
                    matcher.release()
                matched = matcher.read()
                self.assertEqual(matcher.wait(), 0, matcher.error_output())
                self.assertEqual(changing.result(timeout=10), 1)
        self.assertEqual(matched["status"], 201, matched)
        self.assertEqual(matched["body"]["match"]["counterOrder"], seller_id)

    def test_a_foreign_wallet_verification_change_waits_until_matching_commits(self):
        self.assert_foreign_authority_change_waits_for_matching(
            lambda: Wallet.objects.filter(pk=self.wallet.pk).update(verification_status="PENDING"),
            Wallet._meta.db_table,
        )

    def test_a_foreign_owner_deactivation_waits_until_matching_commits(self):
        self.assert_foreign_authority_change_waits_for_matching(
            lambda: get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_active=False),
            get_user_model()._meta.db_table,
        )

    def test_a_busy_owner_deactivation_is_retryable_then_excludes_the_inactive_counterparty(self):
        seller_id = self.seller_order()
        signed_buy = self.buyer_intent()
        connected = Event()
        release = Event()

        def deactivate():
            try:
                with use_operator(), atomic():
                    changed = get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_active=False)
                    connected.set()
                    if not release.wait(20):
                        raise AssertionError("The owner deactivation was never released")
                    return changed
            finally:
                connections.close_all()

        with ThreadPoolExecutor(1) as pool:
            changing = pool.submit(deactivate)
            try:
                self.assertTrue(connected.wait(5))
                busy = self.create(signed_buy)
                self.assert_busy_submission_is_pending(signed_buy, {"status": busy.status_code, "body": busy.json()})
            finally:
                release.set()
            self.assertEqual(changing.result(timeout=10), 1)
        matched = self.create(signed_buy)
        self.assertEqual(matched.status_code, 201, matched.content)
        self.assertIsNone(matched.json()["match"])
        with use_operator():
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).filled_quantity, 0)


class CrossAccountMatchingProcessTest(CrossAccountMatchingProcessChecks, APITransactionTestCase):
    pass


class ScopedCrossAccountMatchingProcessTest(
    RunsOnTheScopedConnection, CrossAccountMatchingProcessChecks, APITransactionTestCase
):
    pass
