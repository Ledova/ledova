import signal
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.db import connections
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from shared.db import configured, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_eligible, make_tenant
from shared.utils.typed_data import signable_message
from tokens.models import SigningChallenge, SwapOrder, TransferOrder
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

    def seller_order(self):
        self.client.force_authenticate(self.tenant.user)
        signed = self.signed_body(self.body(order_type="sell"), signer=OWNER)
        response = self.create(signed)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["order"]["uuid"]

    def buyer_intent(self, *, buyer=None, wallet=None, signer=COUNTERPARTY, price="2.50"):
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
            ),
            signer=signer,
        )


class CrossAccountMatchingChecks(CrossAccountMatchingFixtures):
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

    def test_two_buyers_wait_on_one_foreign_order_and_only_one_matches(self):
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
            waiting = two.read()
            wait_for_row_lock(self, waiting["pid"], "tokens_transferorder", holding["pid"])
            one.release()
            matched, unmatched = one.read(), two.read()
            self.assertEqual((one.wait(), two.wait()), (0, 0), (one.error_output(), two.error_output()))
        self.assertEqual((matched["status"], unmatched["status"]), (201, 201))
        self.assertEqual(matched["body"]["match"]["counterOrder"], seller_id)
        self.assertIsNone(unmatched["body"]["match"])
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
            wait_for_row_lock(self, waiting["pid"], "tokens_transferorder", holding["pid"])
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

    def test_matching_waits_for_the_foreign_sellers_modify_and_uses_its_committed_terms(self):
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
            holding = action.read()
            matcher = OrderChild(
                self, "order_submission_worker", "compete", directory, body=signed_buy, user_id=self.buyer.user.pk
            )
            waiting = matcher.read()
            wait_for_row_lock(self, waiting["pid"], "tokens_transferorder", holding["pid"])
            action.release()
            applied, matched = action.read(), matcher.read()
            self.assertEqual((action.wait(), matcher.wait()), (0, 0), (action.error_output(), matcher.error_output()))
        self.assertEqual((applied["status"], matched["status"]), (200, 201))
        with use_operator():
            swap = SwapOrder.objects.get(pk=matched["body"]["match"]["swapOrder"])
            self.assertEqual((swap.share_amount, swap.payment_amount), (10, 3000))
            self.assertEqual(TransferOrder.objects.get(pk=seller_id).modification_count, 1)


class CrossAccountMatchingProcessTest(CrossAccountMatchingProcessChecks, APITransactionTestCase):
    pass


class ScopedCrossAccountMatchingProcessTest(
    RunsOnTheScopedConnection, CrossAccountMatchingProcessChecks, APITransactionTestCase
):
    pass
