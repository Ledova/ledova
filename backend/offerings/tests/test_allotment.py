from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from web3 import Web3

from blockchain.tests.outgoing_fixtures import admitted_signer
from offerings.exceptions import SubscriptionRefusedException
from offerings.models import Offering, Subscription, SubscriptionStatus
from offerings.services import subscription as subscription_service
from offerings.services.subscription import (
    ALLOTMENT_ABOVE_HEADROOM,
    ALREADY_ALLOTTED,
    BATCH_ABOVE_HEADROOM,
    ISSUANCE_ALREADY_CLAIMED,
    MINT_BROADCAST,
    NO_REQUEST_TO_RETRY,
    NOT_PAID,
    NOTHING_TO_ALLOT,
    allot,
    allot_batch,
    cap_headroom,
    confirm_payment,
    record_refund,
    reject,
    retry_allotment,
    scale_back,
    withdraw,
)
from offerings.tasks.subscription import allot_subscription_task
from offerings.tests.factories import (
    configure_operator,
    draft_subscription,
    eligible_subscriber,
    extra_wallet,
    open_offering,
    paid_subscription,
)
from shared.tests.tenants import make_tenant
from tokens.exceptions import IssuanceExecutionConflict
from tokens.models import (
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution, legacy_issuance, share_token_service
from tokens.tests.issuance_fixtures import (
    CHAIN_ID,
    FINALITY_POLICIES,
    KEY,
    IssuanceNode,
)

CHAIN_CLIENT = "tokens.services.share_token_service.get_base_chain_client"
DEFER = "offerings.tasks.subscription.allot_subscription_task.defer"
SUPPLY = "tokens.services.share_token_service.share_supply"
SIGNER = "0x" + "e" * 40
ROOMY = (1000000, 0)


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES
)
class AllotmentTestCase(TransactionTestCase):
    def setUp(self):
        chain = patch(CHAIN_CLIENT).start().return_value
        chain.is_valid_address.return_value = True
        chain.to_checksum_address.side_effect = Web3.to_checksum_address
        chain.get_address_from_private_key.return_value = SIGNER
        self.defer = patch(DEFER).start()
        self.supply = patch(SUPPLY, return_value=ROOMY).start()
        self.addCleanup(patch.stopall)

        self.tenant = make_tenant("allot")
        configure_operator()
        self.offering = open_offering(self.tenant, target_shares=200, cap_shares=500)
        eligible_subscriber(self.tenant)
        self.operator_user = make_tenant("allot-staff", staff=True).user
        self.operator_user.is_superuser = True
        self.operator_user.save(update_fields=["is_superuser"])
        self.node = IssuanceNode()
        self.enterContext(
            patch("tokens.services.issuance_execution.get_base_chain_client", return_value=self.node.client)
        )
        self.enterContext(patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=True))
        admitted_signer()

    def _execute(self, request):
        command = ShareIssuanceExecution.objects.get(request_id=request.pk)
        return issuance_execution.recover(command.pk)

    def _confirmation(self, subscription):
        subscription.refresh_from_db()
        return issuance_execution.confirmation(
            subscription.issuance_request, self.operator_user, subscription=subscription
        )

    def _historical(self, **kwargs):
        subscription = paid_subscription(self.tenant, quantity=10, **kwargs)
        request = ShareIssuanceRequest.objects.create(
            token=self.offering.token,
            recipient_address=subscription.wallet.address,
            amount=10,
            dispatch_id=None,
            status="approved",
        )
        subscription.issuance_request = request
        subscription.save(update_fields=["issuance_request"])
        return subscription, request

    def _cap(self, offering, shares):
        Offering.objects.filter(pk=offering.pk).update(minimum_shares=1, target_shares=shares, cap_shares=shares)
        offering.refresh_from_db()

    def _supply(self, authorized=1000, issued=0):
        service = patch("offerings.services.subscription.share_token_service").start()
        service.share_supply.return_value = (authorized, issued)
        service.create_issuance_request.side_effect = _create_request
        return service


def _create_request(token, recipient, amount, user, reason="", issuance_type="additional"):
    return ShareIssuanceRequest.objects.create(
        token=token,
        recipient_address=recipient,
        amount=amount,
        reason=reason,
        issuance_type=issuance_type,
        submitted_by=user,
    )


class AllotOneSubscriptionTest(AllotmentTestCase):
    def test_finality_keeps_allotment_and_refund_held_until_atomic_completion(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        request = allot(subscription, self.operator_user)
        self.node.finalized = 11
        self.assertEqual(self._execute(request)["status"], "executing")
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        with self.assertRaises(SubscriptionRefusedException):
            record_refund(subscription, Decimal("1.00"))
        self.node.finalized = 12
        original = Subscription.mark_allotted

        def interrupted(row):
            original(row)
            raise RuntimeError("Synthetic allotment completion interruption")

        with patch.object(Subscription, "mark_allotted", interrupted):
            with self.assertRaises(RuntimeError):
                self._execute(request)
        subscription.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual((subscription.status, request.status), (SubscriptionStatus.PAID, RequestStatus.EXECUTING))
        self.assertIsNone(request.executed_at)
        self.assertEqual(ShareIssuanceExecution.objects.get(request_id=request.pk).status, "executing")
        self.assertEqual(self._execute(request)["status"], "executed")
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ALLOTTED)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_paid_subscription_creates_an_approved_request_and_defers_the_mint(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        request = allot(subscription, self.operator_user, notes="Allotted by the operator")

        subscription.refresh_from_db()
        self.assertEqual(subscription.issuance_request, request)
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self.assertEqual(request.status, RequestStatus.APPROVED)
        self.assertEqual(request.amount, 10)
        self.assertEqual(request.recipient_address, self.tenant.wallet.address)
        self.assertEqual(request.reviewed_by, self.operator_user)
        self.assertEqual(request.review_notes, "Allotted by the operator")
        self.assertEqual(
            self.defer.call_args.kwargs,
            {
                "subscription_uuid": str(subscription.uuid),
                "executed_by": self.operator_user.pk,
                "execution_id": str(request.dispatch_id),
            },
        )

    def test_allotting_the_same_subscription_twice_refuses_and_creates_one_request(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        request = allot(subscription, self.operator_user)

        with self.assertRaises(SubscriptionRefusedException) as raised:
            allot(subscription, self.operator_user)

        self.assertEqual(str(raised.exception.detail), ALREADY_ALLOTTED.format(uuid=request.pk))
        self.assertEqual(ShareIssuanceRequest.objects.filter(token=self.offering.token).count(), 1)
        self.assertEqual(self.defer.call_count, 1)

    def test_a_subscription_that_is_not_paid_cannot_be_allotted(self):
        subscription = draft_subscription(self.tenant)
        with self.assertRaises(SubscriptionRefusedException) as raised:
            allot(subscription, self.operator_user)
        self.assertEqual(str(raised.exception.detail), NOT_PAID.format(status="draft"))
        self.assertFalse(ShareIssuanceRequest.objects.exists())

    def test_a_subscription_scaled_to_nothing_is_refused_rather_than_minting_zero(self):
        subscription = paid_subscription(self.tenant, quantity=10, allotted=0)
        with self.assertRaises(SubscriptionRefusedException) as raised:
            allot(subscription, self.operator_user)
        self.assertEqual(str(raised.exception.detail), NOTHING_TO_ALLOT)

    def test_a_scaled_back_subscription_mints_the_scaled_amount(self):
        subscription = paid_subscription(self.tenant, quantity=10, allotted=4)
        request = allot(subscription, self.operator_user)
        self.assertEqual(request.amount, 4)

    def test_retry_requeues_accepted_work_and_replays_terminal_success(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        request = allot(subscription, self.operator_user)
        self.defer.reset_mock()
        retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.assertEqual(self.defer.call_count, 1)
        self.assertEqual(self._execute(request)["status"], "executed")
        self.defer.reset_mock()
        retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.defer.assert_not_called()
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_failed_request_requires_its_confirmed_retry(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        request = allot(subscription, self.operator_user)
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic unsigned failure")
        self.assertEqual(self._execute(request)["status"], "failed")
        self.defer.reset_mock()
        retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.assertEqual(self.defer.call_count, 1)
        self.node.client.estimate_gas.side_effect = None
        self.assertEqual(self._execute(request)["status"], "executed")

    def test_a_subscription_with_no_request_has_nothing_to_retry(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        with self.assertRaises(SubscriptionRefusedException) as raised:
            retry_allotment(subscription, self.operator_user, confirmed="")
        self.assertEqual(str(raised.exception.detail), NO_REQUEST_TO_RETRY)


class MoneyOutNeverLeavesSharesOutTest(AllotmentTestCase):
    def _allotted(self, **kwargs):
        subscription = paid_subscription(self.tenant, quantity=10, **kwargs)
        return subscription, allot(subscription, self.operator_user)

    def _claimed(self, request, verb):
        request.refresh_from_db()
        return ISSUANCE_ALREADY_CLAIMED.format(
            uuid=request.uuid, status=request.get_status_display().lower(), verb=verb
        )

    def test_a_refund_before_the_mint_rejects_the_request_so_the_task_mints_nothing(self):
        subscription, request = self._allotted()
        record_refund(subscription, amount=Decimal("25.00"), reference="RTGS-9")

        subscription.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.REFUNDED)
        self.assertEqual(request.status, RequestStatus.REJECTED)
        self.assertFalse(request.can_be_executed)
        self.assertIn(str(subscription.reference), request.rejection_reason)

        result = allot_subscription_task(
            subscription_uuid=str(subscription.uuid),
            executed_by=self.operator_user.pk,
            execution_id=str(request.dispatch_id),
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "rejected")
        self.assertFalse(ShareIssuance.objects.exists())

    def test_a_refund_is_refused_once_the_worker_has_claimed_the_mint(self):
        subscription, request = self._allotted()
        issuance_execution._start(ShareIssuanceExecution.objects.get(request_id=request.pk))

        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("25.00"))
        self.assertIn("claimed", str(raised.exception.detail).lower())
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self.assertIsNone(subscription.refunded_at)

    def test_a_refund_is_refused_after_the_mint_and_before_the_reconciler_catches_up(self):
        subscription, request = self._historical()
        ShareIssuanceRequest.objects.filter(pk=request.pk).update(status=RequestStatus.EXECUTED)

        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("25.00"))
        self.assertEqual(str(raised.exception.detail), self._claimed(request, "A refund"))
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)

    def test_reject_and_withdraw_are_refused_while_a_mint_stands(self):
        subscription, request = self._historical()
        ShareIssuanceRequest.objects.filter(pk=request.pk).update(status=RequestStatus.EXECUTED)

        for call, verb in ((reject, "Rejecting it"), (withdraw, "Withdrawing it")):
            with self.subTest(verb=verb):
                with self.assertRaises(SubscriptionRefusedException) as raised:
                    call(subscription, "Unwinding")
                self.assertEqual(str(raised.exception.detail), self._claimed(request, verb))
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)

    def test_the_payment_cannot_be_restated_once_the_shares_are_claimed(self):
        subscription, request = self._allotted()
        with self.assertRaises(SubscriptionRefusedException) as raised:
            confirm_payment(
                subscription,
                confirmed_by=self.operator_user,
                amount_received=Decimal("5.00"),
                received_on=timezone.now().date(),
                accept_as_final=True,
            )
        self.assertEqual(str(raised.exception.detail), self._claimed(request, "Restating the payment"))
        subscription.refresh_from_db()
        self.assertEqual(subscription.amount_received, Decimal("25.00"))
        self.assertIsNone(subscription.allotted_quantity)

    def _broadcast(self, request, tx_hash="0xmint", status=IssuanceStatus.PROCESSING):
        return ShareIssuance.objects.create(
            token=self.offering.token,
            recipient_address=request.recipient_address,
            amount=str(request.amount),
            status=status,
            tx_hash=tx_hash,
            idempotency_key=share_token_service.issuance_key(request),
        )

    def _lost_the_receipt(self):
        subscription, request = self._historical()
        issuance = self._broadcast(request)
        issuance.mark_failed("receipt lost after the transaction was sent")
        request.mark_failed("receipt lost after the transaction was sent")
        subscription.refresh_from_db()
        return subscription, request, issuance

    def _broadcast_refusal(self, request, tx_hash, verb):
        return MINT_BROADCAST.format(uuid=request.uuid, tx_hash=tx_hash, verb=verb)

    def _unidentified_legacy_mint(self):
        subscription, request = self._historical()
        issuance = self._broadcast(request, tx_hash=None, status=IssuanceStatus.FAILED)
        request.mark_failed("Legacy worker stopped without recording its transaction identity")
        subscription.refresh_from_db()
        self.assertIsNone(issuance.mint_journal)
        self.assertEqual(request.status, RequestStatus.FAILED)
        return subscription, request

    def test_a_legacy_hashless_failed_mint_blocks_a_refund(self):
        subscription, request = self._unidentified_legacy_mint()
        with self.assertRaisesMessage(SubscriptionRefusedException, "unidentified legacy mint"):
            record_refund(subscription, amount=Decimal("25.00"))
        subscription.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self.assertIsNone(subscription.refunded_at)
        self.assertEqual(request.status, RequestStatus.FAILED)

    def test_an_admitted_failure_before_signing_can_still_be_refunded(self):
        subscription, request = self._allotted()
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic unsigned failure")
        self.assertEqual(self._execute(request)["status"], "failed")
        issuance = ShareIssuance.objects.get()
        self.assertIsNone(issuance.tx_hash)
        record_refund(subscription, amount=Decimal("25.00"))
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.REFUNDED)
        self.assertEqual(ShareIssuanceExecution.objects.get().status, "cancelled")

    def test_an_abandoned_historical_unsigned_attempt_can_still_be_refunded(self):
        subscription, request = self._historical()
        request.mark_executing()
        issuance = self._broadcast(request, tx_hash=None)
        issuance.mint_journal = [{"id": str(uuid4())}]
        issuance.save(update_fields=["mint_journal"])
        self.assertEqual(legacy_issuance.resolve_executing_issuance(request), "released")
        issuance.refresh_from_db()
        self.assertTrue(issuance.mint_journal[-1]["abandoned"])
        record_refund(subscription, amount=Decimal("25.00"))
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.REFUNDED)

    def test_a_refund_is_refused_while_a_failed_request_still_carries_a_broadcast_mint(self):
        subscription, request, issuance = self._lost_the_receipt()
        self.assertTrue(request.can_be_executed)

        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("25.00"))

        self.assertEqual(str(raised.exception.detail), self._broadcast_refusal(request, "0xmint", "A refund"))
        subscription.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self.assertIsNone(subscription.refunded_at)
        self.assertIsNone(subscription.refund_amount)
        self.assertEqual(request.status, RequestStatus.FAILED)
        self.assertEqual(issuance.tx_hash, "0xmint")

    def test_reject_withdraw_and_a_restated_payment_wait_for_the_broadcast_mint_too(self):
        subscription, request, _ = self._lost_the_receipt()
        calls = (
            (lambda: reject(subscription, "Unwinding"), "Rejecting it"),
            (lambda: withdraw(subscription, "Unwinding"), "Withdrawing it"),
            (
                lambda: confirm_payment(
                    subscription,
                    confirmed_by=self.operator_user,
                    amount_received=Decimal("5.00"),
                    received_on=timezone.now().date(),
                    accept_as_final=True,
                ),
                "Restating the payment",
            ),
        )
        for call, verb in calls:
            with self.subTest(verb=verb):
                with self.assertRaises(SubscriptionRefusedException) as raised:
                    call()
                self.assertEqual(str(raised.exception.detail), self._broadcast_refusal(request, "0xmint", verb))
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)

    def test_a_historical_mint_cannot_enter_new_admission(self):
        subscription, request, _ = self._lost_the_receipt()
        self.defer.reset_mock()
        with self.assertRaises(IssuanceExecutionConflict):
            retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.defer.assert_not_called()

    def test_a_reverted_mint_retains_its_hash_and_the_refund_is_open_again(self):
        subscription, request = self._allotted()
        self.node.receipt_status = 0
        result = self._execute(request)
        self.assertEqual(result["status"], "failed")
        issuance = ShareIssuance.objects.get()
        self.assertIsNotNone(issuance.tx_hash)
        record_refund(subscription, amount=Decimal("25.00"), reference="RTGS-REVERTED")
        subscription.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.REFUNDED)
        self.assertEqual(request.status, RequestStatus.REJECTED)
        self.assertFalse(request.can_be_executed)

    def test_a_refunded_subscription_can_be_closed_and_never_retried(self):
        subscription, request = self._allotted()
        confirmed = self._confirmation(subscription)
        record_refund(subscription, amount=Decimal("25.00"))
        subscription.refresh_from_db()
        retry_allotment(subscription, self.operator_user, confirmed=confirmed)
        self.assertEqual(self._execute(request)["status"], "rejected")
        self.assertFalse(self.node.broadcasts)
        reject(subscription, reason="Unwound after the refund")
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.REJECTED)


class BulkAllotmentTest(AllotmentTestCase):
    def _three(self):
        return [
            paid_subscription(self.tenant, quantity=40, wallet=extra_wallet(self.tenant, letter))
            for letter in ("1", "2", "3")
        ]

    def test_a_batch_inside_the_headroom_allots_every_row(self):
        service = self._supply(authorized=1000, issued=0)
        result = allot_batch(self._three(), self.operator_user, service=service)

        self.assertEqual(result, {"allotted": 3, "refusals": []})
        self.assertEqual(ShareIssuanceRequest.objects.count(), 3)
        self.assertEqual(service.share_supply.call_count, 1)

    def test_the_whole_batch_is_refused_when_it_would_pass_the_offering_cap(self):
        rows = self._three()
        self._cap(self.offering, 100)
        service = self._supply(authorized=1000, issued=0)
        result = allot_batch(rows, self.operator_user, service=service)

        self.assertEqual(result["allotted"], 0)
        self.assertEqual(
            result["refusals"],
            [
                BATCH_ABOVE_HEADROOM.format(
                    total=120, symbol=self.offering.token.symbol, room=100, cap_room=100, chain_room=1000
                )
            ],
        )
        self.assertFalse(ShareIssuanceRequest.objects.exists())
        self.assertFalse(Subscription.objects.exclude(issuance_request__isnull=True).exists())

    def test_the_whole_batch_is_refused_when_the_chain_has_less_room_than_the_cap(self):
        service = self._supply(authorized=1000, issued=950)
        result = allot_batch(self._three(), self.operator_user, service=service)

        self.assertEqual(result["allotted"], 0)
        self.assertIn("50 still available", result["refusals"][0])
        self.assertFalse(ShareIssuanceRequest.objects.exists())

    def test_an_earlier_allotment_eats_the_offering_headroom_of_the_next_batch(self):
        first, second, third = self._three()
        self._cap(self.offering, 100)
        service = self._supply(authorized=1000, issued=0)

        self.assertEqual(allot_batch([first, second], self.operator_user, service=service)["allotted"], 2)
        self.assertEqual(cap_headroom(self.offering), 20)

        result = allot_batch([third], self.operator_user, service=service)
        self.assertEqual(result["allotted"], 0)
        self.assertIn("20 left under the offering cap", result["refusals"][0])

    def test_a_second_batch_cannot_promise_the_shares_the_first_batch_already_took(self):
        first, second, third = self._three()
        service = self._supply(authorized=100, issued=0)

        self.assertEqual(allot_batch([first, second], self.operator_user, service=service)["allotted"], 2)

        result = allot_batch([third], self.operator_user, service=service)
        third.refresh_from_db()

        self.assertEqual(result["allotted"], 0)
        self.assertIn("20 left of the authorized supply", result["refusals"][0])
        self.assertEqual(ShareIssuanceRequest.objects.count(), 2)
        self.assertIsNone(third.issuance_request_id)
        self.assertEqual(third.status, SubscriptionStatus.PAID)

    def test_a_request_the_chain_has_already_minted_stops_holding_room(self):
        first, second, third = self._three()
        self.assertEqual(
            allot_batch([first, second], self.operator_user, service=self._supply(authorized=150))["allotted"], 2
        )
        for request in ShareIssuanceRequest.objects.all():
            self.assertEqual(self._execute(request)["status"], "executed")

        result = allot_batch([third], self.operator_user, service=self._supply(authorized=150, issued=80))
        self.assertEqual(result, {"allotted": 1, "refusals": []})
        self.assertEqual(ShareIssuanceRequest.objects.count(), 3)

    def test_two_offerings_are_grouped_and_judged_separately(self):
        other = make_tenant("second-issuer")
        open_offering(other)
        eligible_subscriber(other)
        mine = paid_subscription(self.tenant, quantity=40)
        theirs = paid_subscription(other, quantity=50)
        self._cap(other.offering, 10)

        service = self._supply(authorized=1000, issued=0)
        result = allot_batch([mine, theirs], self.operator_user, service=service)
        self.assertEqual(result["allotted"], 1)
        self.assertEqual(len(result["refusals"]), 1)
        mine.refresh_from_db()
        theirs.refresh_from_db()
        self.assertIsNotNone(mine.issuance_request_id)
        self.assertIsNone(theirs.issuance_request_id)


class ScaleBackTest(AllotmentTestCase):
    def test_scale_back_is_pro_rata_and_never_raises_a_request(self):
        first = paid_subscription(self.tenant, quantity=60, wallet=extra_wallet(self.tenant, "1"))
        second = paid_subscription(self.tenant, quantity=30, wallet=extra_wallet(self.tenant, "2"))
        second_created = second.created_at
        self._cap(self.offering, 50)

        result = scale_back(self.offering)
        first.refresh_from_db()
        second.refresh_from_db()

        self.assertEqual(result, {"scaled": 2, "requested": 90, "room": 50})
        self.assertEqual(first.allotted_quantity, 33)
        self.assertEqual(second.allotted_quantity, 16)
        self.assertLessEqual(first.allotted_quantity + second.allotted_quantity, 50)
        self.assertLess(first.allotted_quantity, first.quantity)
        self.assertEqual(second.created_at, second_created)

    def test_scale_back_leaves_a_batch_that_already_fits(self):
        first = paid_subscription(self.tenant, quantity=40, wallet=extra_wallet(self.tenant, "1"))
        second = paid_subscription(self.tenant, quantity=30, wallet=extra_wallet(self.tenant, "2"))

        self.assertEqual(scale_back(self.offering), {"scaled": 0, "requested": 70, "room": 500})
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertIsNone(first.allotted_quantity)
        self.assertIsNone(second.allotted_quantity)

    def test_scale_back_never_raises_an_allotment_already_cut_by_a_partial_payment(self):
        partial = paid_subscription(self.tenant, quantity=80, allotted=20, wallet=extra_wallet(self.tenant, "1"))
        self._cap(self.offering, 100)

        self.assertEqual(scale_back(self.offering), {"scaled": 0, "requested": 20, "room": 100})
        partial.refresh_from_db()
        self.assertEqual(partial.allotted_quantity, 20)

    def test_a_scaled_batch_then_fits_inside_the_cap(self):
        rows = [
            paid_subscription(self.tenant, quantity=60, wallet=extra_wallet(self.tenant, "1")),
            paid_subscription(self.tenant, quantity=30, wallet=extra_wallet(self.tenant, "2")),
        ]
        self._cap(self.offering, 50)
        scale_back(self.offering)
        for row in rows:
            row.refresh_from_db()

        service = self._supply(authorized=1000, issued=0)
        self.assertEqual(allot_batch(rows, self.operator_user, service=service)["allotted"], 2)
        self.assertEqual(cap_headroom(self.offering), 1)

    def test_the_amount_due_is_untouched_by_a_scale_back(self):
        subscription = paid_subscription(self.tenant, quantity=60, wallet=extra_wallet(self.tenant, "1"))
        self._cap(self.offering, 50)
        scale_back(self.offering)
        subscription.refresh_from_db()
        self.assertEqual(subscription.amount_due, Decimal("150.00"))
        self.assertEqual(subscription.allotted_quantity, 50)


class SingleAllotmentHeadroomTest(AllotmentTestCase):
    def test_the_cap_is_guarded_on_the_single_entry_point_not_only_on_the_batch(self):
        rows = [
            paid_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, letter))
            for letter in ("1", "2", "3")
        ]
        self._cap(self.offering, 10)
        self.supply.return_value = (10, 0)

        self.assertEqual(allot(rows[0], self.operator_user).amount, 10)
        for row in rows[1:]:
            with self.subTest(row=row.pk):
                with self.assertRaises(SubscriptionRefusedException) as raised:
                    allot(row, self.operator_user)
                self.assertEqual(
                    str(raised.exception.detail),
                    ALLOTMENT_ABOVE_HEADROOM.format(
                        amount=10, symbol=self.offering.token.symbol, room=0, cap_room=0, chain_room=0
                    ),
                )

        self.assertEqual(cap_headroom(self.offering), 0)
        self.assertEqual(ShareIssuanceRequest.objects.count(), 1)
        self.assertEqual(self.defer.call_count, 1)

    def test_the_authorized_supply_stops_a_single_allotment_the_cap_would_allow(self):
        subscription = paid_subscription(self.tenant, quantity=40)
        self.supply.return_value = (30, 0)

        with self.assertRaises(SubscriptionRefusedException) as raised:
            allot(subscription, self.operator_user)

        self.assertEqual(
            str(raised.exception.detail),
            ALLOTMENT_ABOVE_HEADROOM.format(
                amount=40, symbol=self.offering.token.symbol, room=30, cap_room=500, chain_room=30
            ),
        )
        self.assertFalse(ShareIssuanceRequest.objects.exists())

    def test_a_batch_still_reads_the_chain_supply_once_for_the_whole_group(self):
        rows = [
            paid_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, letter))
            for letter in ("1", "2", "3")
        ]
        service = self._supply(authorized=1000, issued=0)

        self.assertEqual(allot_batch(rows, self.operator_user, service=service)["allotted"], 3)
        self.assertEqual(service.share_supply.call_count, 1)

    def test_a_stale_row_is_refused_on_its_own_and_the_rest_of_the_batch_still_goes(self):
        already = paid_subscription(self.tenant, quantity=40, wallet=extra_wallet(self.tenant, "1"))
        allot(already, self.operator_user)
        fresh = paid_subscription(self.tenant, quantity=40, wallet=extra_wallet(self.tenant, "2"))
        self._cap(self.offering, 80)

        service = self._supply(authorized=1000, issued=0)
        result = allot_batch([already, fresh], self.operator_user, service=service)
        fresh.refresh_from_db()

        self.assertEqual(result["allotted"], 1)
        self.assertEqual(result["refusals"], [ALREADY_ALLOTTED.format(uuid=already.issuance_request_id)])
        self.assertIsNotNone(fresh.issuance_request_id)

    def test_a_group_of_nothing_but_stale_rows_reads_no_supply_and_refuses_each_row(self):
        already = paid_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, "1"))
        allot(already, self.operator_user)
        unpaid = draft_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, "2"))

        service = self._supply(authorized=1000, issued=0)
        result = allot_batch([already, unpaid], self.operator_user, service=service)

        self.assertEqual(result["allotted"], 0)
        self.assertEqual(
            result["refusals"],
            [ALREADY_ALLOTTED.format(uuid=already.issuance_request_id), NOT_PAID.format(status="draft")],
        )
        self.assertEqual(service.share_supply.call_count, 0)


class HeadroomSnapshotConsistencyTest(AllotmentTestCase):
    def _pending_mint(self, amount):
        request = ShareIssuanceRequest.objects.create(
            token=self.offering.token,
            recipient_address="0x" + "a" * 40,
            amount=amount,
            submitted_by=self.operator_user,
            dispatch_id=None,
        )
        ShareIssuanceRequest.objects.filter(pk=request.pk).update(status=RequestStatus.APPROVED)
        return request

    def test_a_mint_confirming_after_the_supply_snapshot_cannot_inflate_the_chain_room(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        self.supply.return_value = (1000, 0)
        pending = self._pending_mint(995)
        read_the_row = subscription_service._locked

        def confirm_the_pending_mint(row):
            ShareIssuanceRequest.objects.filter(pk=pending.pk).update(status=RequestStatus.EXECUTED)
            return read_the_row(row)

        with patch.object(subscription_service, "_locked", confirm_the_pending_mint):
            with self.assertRaises(SubscriptionRefusedException) as raised:
                allot(subscription, self.operator_user)

        self.assertEqual(
            str(raised.exception.detail),
            ALLOTMENT_ABOVE_HEADROOM.format(
                amount=10, symbol=self.offering.token.symbol, room=5, cap_room=500, chain_room=5
            ),
        )
        subscription.refresh_from_db()
        self.assertIsNone(subscription.issuance_request_id)
        self.assertEqual(self.defer.call_count, 0)

    def test_a_request_created_after_the_snapshot_is_still_counted_against_the_chain_room(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        self.supply.return_value = (1000, 0)
        read_the_row = subscription_service._locked

        def create_a_competing_request(row):
            self._pending_mint(995)
            return read_the_row(row)

        with patch.object(subscription_service, "_locked", create_a_competing_request):
            with self.assertRaises(SubscriptionRefusedException) as raised:
                allot(subscription, self.operator_user)

        self.assertEqual(
            str(raised.exception.detail),
            ALLOTMENT_ABOVE_HEADROOM.format(
                amount=10, symbol=self.offering.token.symbol, room=5, cap_room=500, chain_room=5
            ),
        )
        subscription.refresh_from_db()
        self.assertIsNone(subscription.issuance_request_id)

    def test_an_undisturbed_allotment_still_reads_the_chain_once_and_goes_through(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        self.supply.return_value = (1000, 0)
        self._pending_mint(985)

        request = allot(subscription, self.operator_user)

        subscription.refresh_from_db()
        self.assertEqual(subscription.issuance_request_id, request.pk)
        self.assertEqual(self.supply.call_count, 1)


class ScaleBackResidualTest(AllotmentTestCase):
    def _scaled(self, quantity=10, cap=5):
        subscription = paid_subscription(self.tenant, quantity=quantity)
        self._cap(self.offering, cap)
        scale_back(self.offering)
        subscription.refresh_from_db()
        return subscription

    def test_scale_back_records_the_money_it_strands_the_way_a_partial_payment_does(self):
        subscription = self._scaled()
        self.assertEqual(subscription.allotted_quantity, 5)
        self.assertEqual(subscription.amount_received, Decimal("25.00"))
        self.assertEqual(subscription.refund_amount, Decimal("12.50"))
        self.assertEqual(subscription.money_held, Decimal("25.00"))

    def test_scale_back_owes_nothing_when_the_scaled_shares_still_use_every_cent(self):
        first = paid_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, "1"))
        second = paid_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, "2"))
        Subscription.objects.filter(pk=second.pk).update(amount_received=None)
        self._cap(self.offering, 10)

        scale_back(self.offering)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.allotted_quantity, first.refund_amount), (5, Decimal("12.50")))
        self.assertEqual((second.allotted_quantity, second.refund_amount), (5, None))

    def test_a_negative_headroom_scales_to_zero_rather_than_a_negative_quantity(self):
        soaked = paid_subscription(self.tenant, quantity=40, wallet=extra_wallet(self.tenant, "1"))
        allot(soaked, self.operator_user)
        pending = paid_subscription(self.tenant, quantity=10, wallet=extra_wallet(self.tenant, "2"))
        self._cap(self.offering, 10)

        self.assertEqual(cap_headroom(self.offering), -30)
        self.assertEqual(scale_back(self.offering), {"scaled": 1, "requested": 10, "room": -30})

        pending.refresh_from_db()
        self.assertEqual(pending.allotted_quantity, 0)
        self.assertEqual(pending.refund_amount, Decimal("25.00"))

    def test_the_stranded_residual_is_refundable_once_the_shares_are_allotted(self):
        subscription = self._scaled()
        allot(subscription, self.operator_user)
        subscription.refresh_from_db()
        self.assertEqual(self._execute(subscription.issuance_request)["status"], "executed")
        subscription.refresh_from_db()

        self.assertEqual(subscription.amount_refundable, Decimal("12.50"))
        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("12.51"))
        self.assertIn("already claimed on chain", str(raised.exception.detail))

        record_refund(subscription, amount=Decimal("12.50"), reference="RTGS-RESIDUAL")
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ALLOTTED)
        self.assertEqual(subscription.refund_amount, Decimal("12.50"))
        self.assertEqual(subscription.money_held, Decimal("12.50"))
        self.assertEqual(subscription.amount_refundable, Decimal("0.00"))

    def test_the_money_that_paid_for_allotted_shares_can_never_come_back(self):
        subscription = paid_subscription(self.tenant, quantity=10)
        allot(subscription, self.operator_user)
        subscription.refresh_from_db()
        self.assertEqual(self._execute(subscription.issuance_request)["status"], "executed")
        subscription.refresh_from_db()

        self.assertEqual(subscription.amount_refundable, Decimal("0.00"))
        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("0.01"))
        self.assertIn("already claimed on chain", str(raised.exception.detail))
        subscription.refresh_from_db()
        self.assertIsNone(subscription.refunded_at)
