from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from blockchain.tests.outgoing_fixtures import admitted_signer
from offerings.models import Subscription, SubscriptionStatus
from offerings.querysets.subscription import SubscriptionQuerySet
from offerings.services.subscription import allot, retry_allotment
from offerings.tasks import (
    allot_subscription_task,
    expire_unpaid_subscriptions,
    reconcile_subscriptions,
)
from offerings.tests.factories import (
    allottable_subscription,
    configure_operator,
    draft_subscription,
    eligible_subscriber,
    extra_wallet,
    open_offering,
    paid_subscription,
)
from shared.tests.tenants import make_tenant
from tokens.models import (
    IssuanceStatus,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution
from tokens.tests.issuance_fixtures import (
    CHAIN_ID,
    FINALITY_POLICIES,
    KEY,
    IssuanceNode,
)

WHITELISTED = "tokens.services.share_token_service.is_recipient_whitelisted"
SUPPLY = "tokens.services.share_token_service.share_supply"
DEFER = "offerings.tasks.subscription.allot_subscription_task.defer"


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, WALLET_CHAIN_FINALITY_POLICIES=FINALITY_POLICIES
)
class SubscriptionTaskTestCase(TransactionTestCase):
    def setUp(self):
        self.node = IssuanceNode()
        patch("tokens.services.issuance_execution.get_base_chain_client", return_value=self.node.client).start()
        admitted_signer()
        patch(WHITELISTED, return_value=True).start()
        patch(SUPPLY, return_value=(1000, 0)).start()
        patch("wallets.services.holdings.sync_holding").start()
        self.defer = patch(DEFER).start()
        self.addCleanup(patch.stopall)

        self.tenant = make_tenant("tasks")
        configure_operator()
        self.offering = open_offering(self.tenant, target_shares=200, cap_shares=500)
        eligible_subscriber(self.tenant)
        self.operator_user = make_tenant("tasks-staff", staff=True).user
        self.operator_user.is_superuser = True
        self.operator_user.save(update_fields=["is_superuser"])

    def _allotted(self, quantity=10, wallet=None):
        subscription = allottable_subscription(self.tenant, quantity=quantity, wallet=wallet)
        allot(subscription, self.operator_user)
        subscription.refresh_from_db()
        return subscription


class SubscriptionTaskTest(SubscriptionTaskTestCase):
    def run_allotment(self, subscription):
        return allot_subscription_task(
            str(subscription.pk),
            executed_by=self.operator_user.pk,
            execution_id=str(subscription.issuance_request.dispatch_id),
        )

    def test_the_task_mints_once_and_mirrors_the_subscription_to_allotted(self):
        subscription = self._allotted()
        result = self.run_allotment(subscription)
        self.assertTrue(result["success"], result)
        self.node.client.send_raw_transaction.assert_called_once()
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ALLOTTED)
        self.assertEqual(subscription.issuance_request.status, RequestStatus.EXECUTED)
        self.assertEqual(ShareIssuance.objects.count(), 1)

    def test_running_the_task_twice_returns_the_original_outcome_and_mints_once(self):
        subscription = self._allotted()
        first = self.run_allotment(subscription)
        second = self.run_allotment(subscription)
        self.assertTrue(first["success"], first)
        self.assertEqual(first, second)
        self.node.client.send_raw_transaction.assert_called_once()
        self.assertEqual(ShareIssuance.objects.count(), 1)
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ALLOTTED)

    def test_a_missing_row_or_an_unlinked_subscription_has_no_admitted_job_identity(self):
        unlinked = paid_subscription(self.tenant)
        for identifier in ("00000000-0000-0000-0000-000000000000", str(unlinked.pk)):
            self.assertEqual(
                allot_subscription_task(identifier),
                {"success": False, "error": "Allotment has no matching admitted issuance identity"},
            )
        self.node.client.send_raw_transaction.assert_not_called()

    def test_unsigned_failure_keeps_payment_and_requires_explicit_retry(self):
        subscription = self._allotted()
        self.node.client.estimate_gas.side_effect = RuntimeError("provider unavailable")
        self.assertFalse(self.run_allotment(subscription)["success"])
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self.assertEqual(subscription.issuance_request.status, RequestStatus.FAILED)
        self.assertEqual(ShareIssuance.objects.get().status, IssuanceStatus.FAILED)
        self.node.client.estimate_gas.side_effect = None
        self.assertFalse(self.run_allotment(subscription)["success"])
        request = subscription.issuance_request
        confirmed = issuance_execution.confirmation(request, self.operator_user, subscription=subscription)
        retry_allotment(subscription, self.operator_user, confirmed=confirmed)
        self.assertTrue(self.run_allotment(subscription)["success"])
        subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ALLOTTED)
        self.assertEqual(ShareIssuance.objects.count(), 1)

    def historical_allotment(self, wallet):
        subscription = paid_subscription(self.tenant, wallet=wallet)
        request = ShareIssuanceRequest.objects.create(
            token=self.offering.token,
            recipient_address=wallet.address,
            amount=subscription.quantity,
            reason="Historical mint awaiting subscription projection",
            dispatch_id=None,
            status=RequestStatus.EXECUTED,
        )
        subscription.issuance_request = request
        subscription.save(update_fields=["issuance_request"])
        return subscription

    def test_reconcile_repairs_historical_projection_and_leaves_current_pending_rows_alone(self):
        mirrored = self.historical_allotment(extra_wallet(self.tenant, "1"))
        untouched_paid = paid_subscription(self.tenant, wallet=extra_wallet(self.tenant, "2"))
        untouched_draft = draft_subscription(self.tenant, wallet=extra_wallet(self.tenant, "3"))
        pending = self._allotted(wallet=extra_wallet(self.tenant, "4"))
        self.assertEqual(reconcile_subscriptions(), {"flipped": 1})
        for subscription, expected in (
            (mirrored, "allotted"),
            (untouched_paid, "paid"),
            (untouched_draft, "draft"),
            (pending, "paid"),
        ):
            subscription.refresh_from_db()
            self.assertEqual(subscription.status, expected)
        self.assertEqual(reconcile_subscriptions(), {"flipped": 0})

    def test_a_sweep_takes_a_bounded_bite_and_the_next_run_takes_the_rest(self):
        for letter in ("1", "2", "3"):
            self.historical_allotment(extra_wallet(self.tenant, letter))
        with patch("offerings.tasks.subscription.SWEEP_BATCH", 2):
            self.assertEqual(reconcile_subscriptions(), {"flipped": 2})
            self.assertEqual(reconcile_subscriptions(), {"flipped": 1})
        self.assertEqual(reconcile_subscriptions(), {"flipped": 0})
        self.assertEqual(Subscription.objects.filter(status=SubscriptionStatus.ALLOTTED).count(), 3)

    def test_expiry_only_touches_a_row_with_no_payment_recorded(self):
        overdue = draft_subscription(self.tenant, wallet=extra_wallet(self.tenant, "1"))
        part_paid = draft_subscription(self.tenant, wallet=extra_wallet(self.tenant, "2"))
        in_window = draft_subscription(self.tenant, wallet=extra_wallet(self.tenant, "3"))
        past = timezone.now() - timedelta(days=1)

        Subscription.objects.filter(pk=overdue.pk).update(
            status=SubscriptionStatus.AWAITING_PAYMENT, payment_due_at=past
        )
        Subscription.objects.filter(pk=part_paid.pk).update(
            status=SubscriptionStatus.AWAITING_PAYMENT, payment_due_at=past, amount_received=Decimal("1.00")
        )
        Subscription.objects.filter(pk=in_window.pk).update(
            status=SubscriptionStatus.AWAITING_PAYMENT, payment_due_at=timezone.now() + timedelta(days=1)
        )

        self.assertEqual(expire_unpaid_subscriptions(), {"expired": 1, "left_alone": []})

        overdue.refresh_from_db()
        part_paid.refresh_from_db()
        in_window.refresh_from_db()
        self.assertEqual(overdue.status, SubscriptionStatus.REJECTED)
        self.assertIn("Payment was not received", overdue.payment_notes)
        self.assertEqual(part_paid.status, SubscriptionStatus.AWAITING_PAYMENT)
        self.assertEqual(in_window.status, SubscriptionStatus.AWAITING_PAYMENT)

    def test_expiry_leaves_a_paid_row_alone_even_past_its_due_date(self):
        paid = paid_subscription(self.tenant)
        Subscription.objects.filter(pk=paid.pk).update(payment_due_at=timezone.now() - timedelta(days=5))
        self.assertEqual(expire_unpaid_subscriptions(), {"expired": 0, "left_alone": []})
        paid.refresh_from_db()
        self.assertEqual(paid.status, SubscriptionStatus.PAID)


class ExpirySweepStaleRowTest(SubscriptionTaskTestCase):
    def _overdue(self, suffix):
        subscription = draft_subscription(self.tenant, wallet=extra_wallet(self.tenant, suffix))
        Subscription.objects.filter(pk=subscription.pk).update(
            status=SubscriptionStatus.AWAITING_PAYMENT,
            payment_due_at=timezone.now() - timedelta(days=1),
            reference=f"PAYSWEEP{suffix}",
        )
        subscription.refresh_from_db()
        return subscription

    def test_the_sweep_leaves_alone_a_row_paid_between_the_read_and_the_write(self):
        lapsed = self._overdue("1")
        paid_meanwhile = self._overdue("2")
        read_rows = SubscriptionQuerySet.unpaid_past_due

        def land_a_payment_right_after_the_read(queryset, moment):
            rows = list(read_rows(queryset, moment))
            Subscription.objects.filter(pk=paid_meanwhile.pk).update(
                status=SubscriptionStatus.PAID,
                amount_received=Decimal("25.00"),
                payment_received_on=timezone.now().date(),
            )
            return rows

        with patch.object(SubscriptionQuerySet, "unpaid_past_due", land_a_payment_right_after_the_read):
            result = expire_unpaid_subscriptions()

        self.assertEqual(result, {"expired": 1, "left_alone": [paid_meanwhile.reference]})
        lapsed.refresh_from_db()
        paid_meanwhile.refresh_from_db()
        self.assertEqual(lapsed.status, SubscriptionStatus.REJECTED)
        self.assertEqual(paid_meanwhile.status, SubscriptionStatus.PAID)
        self.assertEqual(paid_meanwhile.money_held, Decimal("25.00"))
        self.assertTrue(paid_meanwhile.has_money_in)

    def test_a_row_closed_between_the_read_and_the_write_is_reported_not_closed_twice(self):
        lapsed = self._overdue("1")
        closed_meanwhile = self._overdue("2")
        read_rows = SubscriptionQuerySet.unpaid_past_due

        def close_it_right_after_the_read(queryset, moment):
            rows = list(read_rows(queryset, moment))
            Subscription.objects.filter(pk=closed_meanwhile.pk).update(status=SubscriptionStatus.WITHDRAWN)
            return rows

        with patch.object(SubscriptionQuerySet, "unpaid_past_due", close_it_right_after_the_read):
            result = expire_unpaid_subscriptions()

        self.assertEqual(result, {"expired": 1, "left_alone": [closed_meanwhile.reference]})
        lapsed.refresh_from_db()
        closed_meanwhile.refresh_from_db()
        self.assertEqual(lapsed.status, SubscriptionStatus.REJECTED)
        self.assertEqual(closed_meanwhile.status, SubscriptionStatus.WITHDRAWN)
