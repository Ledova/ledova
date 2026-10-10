from unittest.mock import patch
from uuid import uuid4

from rest_framework.test import APITransactionTestCase

from companies.models import Company
from shared.db import configured, current_alias, use_migrate, use_operator
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.tenants import make_eligible, make_tenant
from tokens.models import SigningChallenge, SwapOrder, TransferOrder
from tokens.services import token_transfer_service
from tokens.tests.order_submission_fixtures import (
    BASE,
    COUNTERPARTY,
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
            with use_migrate():
                Company.objects.filter(pk=self.tenant.company.pk).update(status="active", is_open_to_investors=True)
            self.buyer_wallet = Wallet.objects.create(
                user_account=self.buyer.account,
                address=COUNTERPARTY.address,
                chain="base",
                verification_status="VERIFIED",
            )

        self.buyer_decision = accept_company_eligibility(self.buyer, issuer_decision=self.eligibility_decision)

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
        self.assertEqual(created.json()["order"]["matchedOrderUuid"], seller_id)
        listed = self.client.get(BASE)
        self.assertEqual(listed.status_code, 200, listed.content)
        uuids = [order["uuid"] for order in listed.json()["results"]]
        self.assertIn(created.json()["order"]["uuid"], uuids)
        self.assertNotIn(seller_id, uuids)
        self.assertEqual(self.recover().status_code, 404)
        forged = self.message(self.body(submission_id=str(uuid4())))
        self.assertEqual(forged.status_code, 400, forged.content)

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


class CrossAccountMatchingTest(CrossAccountMatchingChecks, APITransactionTestCase):
    pass
