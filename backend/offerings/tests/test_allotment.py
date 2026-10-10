from decimal import Decimal
from unittest.mock import patch

from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from offerings.exceptions import SubscriptionRefusedException
from offerings.models import Offering, Subscription, SubscriptionStatus
from offerings.services.subscription import (
    ISSUANCE_ALREADY_CLAIMED,
    NO_REQUEST_TO_RETRY,
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
    eligible_subscriber,
    extra_wallet,
    open_offering,
    paid_subscription,
)
from shared.db import use_operator
from shared.tests.tenants import make_tenant
from tokens.models import (
    RequestStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution
from tokens.tasks import check_executing_issuance_requests
from tokens.tests.company_paid_issue_fixtures import CompanyPaidIssueCases


class AllotmentTestCase(TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.tenant = make_tenant("allot-financial")
        configure_operator()
        self.offering = open_offering(self.tenant, target_shares=200, cap_shares=500)
        eligible_subscriber(self.tenant)

    def _cap(self, offering, shares):
        Offering.objects.filter(pk=offering.pk).update(minimum_shares=1, target_shares=shares, cap_shares=shares)
        offering.refresh_from_db()


class CompanyAllotmentTestCase(CompanyPaidIssueCases, APITransactionTestCase):
    def genuine_paid_subscription(self, *, quantity=10, received=None, final=False):
        return super().genuine_paid_subscription(quantity=quantity, received=received, final=final)

    def setUp(self):
        super().setUp()
        self.offering = self.offer
        self.node = self.issuance_node
        self.operator_user = self.technical

    def _allotted(self):
        proposal = self.applied_paid_issue()
        with use_operator():
            request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
        return self.subscription, request

    def _execute(self, request):
        with use_operator():
            command = ShareIssuanceExecution.objects.get(request_id=request.pk)
            return issuance_execution.recover(command.pk)

    def _confirmation(self, subscription):
        with use_operator():
            subscription.refresh_from_db()
            return issuance_execution.confirmation(
                subscription.issuance_request, self.technical, subscription=subscription
            )

    def _cap(self, offering, shares):
        with use_operator():
            Offering.objects.filter(pk=offering.pk).update(minimum_shares=1, target_shares=shares, cap_shares=shares)
            offering.refresh_from_db()


class AllotOneSubscriptionTest(CompanyAllotmentTestCase):
    def test_a_failed_request_requires_its_confirmed_retry(self):
        subscription, request = self._allotted()
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic unsigned failure")
        self.assertEqual(self._execute(request)["status"], "failed")
        retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.assertEqual(ShareIssuanceExecution.objects.count(), 1)
        self.node.client.estimate_gas.side_effect = None
        self.assertEqual(self._execute(request)["status"], "executed")

    def test_finality_keeps_allotment_and_refund_held_until_atomic_completion(self):
        subscription, request = self._allotted()
        self.node.finalized = self.node.head - 1
        self.assertEqual(self._execute(request)["status"], "executing")
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        with self.assertRaises(SubscriptionRefusedException):
            record_refund(subscription, Decimal("1.00"))
        self.node.finalized = self.node.head
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
        self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 1})
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ALLOTTED)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_retry_requeues_accepted_work_and_replays_terminal_success(self):
        subscription, request = self._allotted()
        retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.assertEqual(ShareIssuanceExecution.objects.count(), 1)
        self.assertEqual(self._execute(request)["status"], "executed")
        retry_allotment(subscription, self.operator_user, confirmed=self._confirmation(subscription))
        self.assertEqual(ShareIssuanceExecution.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_subscription_with_no_request_has_nothing_to_retry(self):
        subscription = self.subscription
        with self.assertRaises(SubscriptionRefusedException) as raised:
            retry_allotment(subscription, self.operator_user, confirmed="")
        self.assertEqual(str(raised.exception.detail), NO_REQUEST_TO_RETRY)

    def test_a_scaled_back_subscription_mints_the_scaled_amount(self):
        self._cap(self.offering, 4)
        scale_back(self.offering)
        subscription, request = self._allotted()
        self.assertEqual(request.amount, 4)


class MoneyOutNeverLeavesSharesOutTest(CompanyAllotmentTestCase):
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
            executed_by=self.owner.pk,
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

    def test_a_refund_is_refused_after_the_mint_while_finality_is_pending(self):
        subscription, request = self._allotted()
        self.node.finalized = self.node.head - 1
        self.assertEqual(self._execute(request)["status"], "executing")

        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("25.00"))
        self.assertEqual(str(raised.exception.detail), self._claimed(request, "A refund"))
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)

    def test_reject_and_withdraw_are_refused_while_a_mint_stands(self):
        subscription, request = self._allotted()
        self.node.finalized = self.node.head - 1
        self.assertEqual(self._execute(request)["status"], "executing")

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

    def test_the_amount_due_is_untouched_by_a_scale_back(self):
        subscription = paid_subscription(self.tenant, quantity=60, wallet=extra_wallet(self.tenant, "1"))
        self._cap(self.offering, 50)
        scale_back(self.offering)
        subscription.refresh_from_db()
        self.assertEqual(subscription.amount_due, Decimal("150.00"))
        self.assertEqual(subscription.allotted_quantity, 50)


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


class AllottedMoneyBackingTest(CompanyAllotmentTestCase):
    def test_the_stranded_residual_is_refundable_once_the_shares_are_allotted(self):
        self._cap(self.offering, 5)
        scale_back(self.offering)
        subscription, _ = self._allotted()
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
        subscription, _ = self._allotted()
        subscription.refresh_from_db()
        self.assertEqual(self._execute(subscription.issuance_request)["status"], "executed")
        subscription.refresh_from_db()

        self.assertEqual(subscription.amount_refundable, Decimal("0.00"))
        with self.assertRaises(SubscriptionRefusedException) as raised:
            record_refund(subscription, amount=Decimal("0.01"))
        self.assertIn("already claimed on chain", str(raised.exception.detail))
        subscription.refresh_from_db()
        self.assertIsNone(subscription.refunded_at)

    def test_a_negative_headroom_scales_to_zero_rather_than_a_negative_quantity(self):
        self.applied_paid_issue()
        pending = self.genuine_paid_subscription(quantity=10)
        self._cap(self.offering, 5)
        self.assertEqual(cap_headroom(self.offering), -5)
        self.assertEqual(scale_back(self.offering), {"scaled": 1, "requested": 10, "room": -5})
        pending.refresh_from_db()
        self.assertEqual(pending.allotted_quantity, 0)
        self.assertEqual(pending.refund_amount, Decimal("25.00"))


class HeadroomSnapshotConsistencyTest(CompanyAllotmentTestCase):
    def _pending_mint(self, amount):
        proposal = self.applied_issue(shares=amount)
        return proposal

    def test_a_mint_confirming_after_the_supply_snapshot_cannot_inflate_the_chain_room(self):
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        pending = self._pending_mint(95)

        def captured():
            self.assertEqual(self.execute_issue(pending)["status"], "executed")
            return 100, 0, 0

        with patch("tokens.services.register_paid_issues.chain_snapshot", side_effect=captured):
            with self.assertRaises(ValidationError):
                self.paid_decide(proposal, "apply")
        self.subscription.refresh_from_db()
        self.assertIsNone(self.subscription.issuance_request_id)
        self.assertEqual(cap_headroom(self.offering), 100)

    def test_a_request_created_after_the_snapshot_is_still_counted_against_the_chain_room(self):
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")

        pending = []

        def captured():
            if not pending:
                pending.append(self._pending_mint(95))
            return 100, 0, 0

        with patch("tokens.services.register_paid_issues.chain_snapshot", side_effect=captured):
            with self.assertRaises(ValidationError):
                self.paid_decide(proposal, "apply")
        self.subscription.refresh_from_db()
        self.assertIsNone(self.subscription.issuance_request_id)

    def test_apply_preview_and_application_each_read_fresh_chain_headroom(self):
        self._pending_mint(85)
        proposal = self.prepare_paid_issue()
        self.paid_decide(proposal, "approve")
        with patch("tokens.services.register_paid_issues.chain_snapshot", return_value=(100, 0, 0)) as rpc:
            proposal, _ = self.paid_decide(proposal, "apply")
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.issuance_request_id, proposal.request_id)
        self.assertEqual(rpc.call_count, 2)
        self.assertEqual(ShareIssuanceExecution.objects.filter(subscription_id=self.subscription.pk).count(), 1)
