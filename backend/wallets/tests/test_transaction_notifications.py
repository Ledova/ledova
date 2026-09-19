from unittest.mock import patch

from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.test import APITransactionTestCase

from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from users.models import Notification
from users.tasks.notifications import send_transaction_notification
from wallets.services import transaction_confirmation
from wallets.tests.test_wallet_finality import WalletFinalityFixture

DEFER_NOTIFICATION = send_transaction_notification.defer


class TransactionNotificationChecks(WalletFinalityFixture):
    def job_rows(self):
        with use_operator():
            return list(
                ProcrastinateJob.objects.filter(
                    task_name=send_transaction_notification.name, args__transaction_id=str(self.tx_id)
                ).values()
            )

    def test_final_confirmation_durably_queues_once_for_the_owner(self):
        self.notification.side_effect = DEFER_NOTIFICATION
        self.assertEqual(self.finish()["status"], "confirmed")
        self.assertEqual(self.finish()["status"], "reconciliation_pending")
        rows = self.job_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "todo")
        self.assertEqual(
            rows[0]["args"],
            {
                "user_id": str(self.tenant.user.pk),
                "transaction_id": str(self.tx_id),
                "event_type": "confirmed",
            },
        )
        with patch("users.services.notifications.ExpoPushClient"):
            send_transaction_notification.func(**rows[0]["args"])
        with use_operator():
            row = Notification.objects.filter(notification_type="transaction", user=self.tenant.user).get()
        self.assertEqual(row.user_id, self.tenant.user.pk)
        self.assertEqual(row.title, "Transaction Confirmed")

    def test_final_failure_durably_queues_once_for_the_owner(self):
        self.observer.get_transaction_receipt.return_value["status"] = 0
        self.notification.side_effect = DEFER_NOTIFICATION
        self.assertEqual(self.finish()["status"], "failed")
        self.assertEqual(self.finish()["status"], "reconciliation_pending")
        rows = self.job_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["args"]["event_type"], "failed")
        self.assertEqual(rows[0]["args"]["user_id"], str(self.tenant.user.pk))

    def test_queue_failure_rolls_back_the_outcome_and_its_finality_link(self):
        self.notification.side_effect = RuntimeError("Synthetic queue outage")
        with self.assertRaisesRegex(RuntimeError, "Synthetic queue outage"):
            self.finish()
        tx = self.transactions()[0]
        self.assertEqual(tx["status"], "pending")
        self.assertIsNone(tx["finality_observation_id"])
        self.assertIsNone(tx["balance_reconciliation_token"])
        self.assertEqual(self.job_rows(), [])
        self.notification.side_effect = DEFER_NOTIFICATION
        self.assertEqual(self.settle()["status"], "confirmed")
        self.assertEqual(len(self.job_rows()), 1)

    def test_failure_after_deferring_rolls_back_the_job_with_the_outcome(self):
        self.notification.side_effect = DEFER_NOTIFICATION
        notify = transaction_confirmation._notify_wallet_users

        def interrupted(tx, event):
            notify(tx, event)
            raise RuntimeError("Synthetic post-defer interruption")

        with patch.object(transaction_confirmation, "_notify_wallet_users", side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, "Synthetic post-defer interruption"):
                self.finish()
        self.assertEqual(self.job_rows(), [])
        self.assertEqual(self.transactions()[0]["status"], "pending")
        self.assertEqual(self.settle()["status"], "confirmed")
        self.assertEqual(len(self.job_rows()), 1)


class TransactionNotificationTest(TransactionNotificationChecks, APITransactionTestCase):
    pass


class ScopedTransactionNotificationTest(
    RunsOnTheScopedConnection, TransactionNotificationChecks, APITransactionTestCase
):
    pass
