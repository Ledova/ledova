import logging
from decimal import Decimal
from typing import Any, Dict, Optional

from integrations.expo_push import ExpoPushClient, ExpoPushError
from shared.utils.share_classes import share_class_label
from shared.utils.token_amounts import format_amount
from users.models import DeviceToken, Notification, UserPreferences

logger = logging.getLogger(__name__)

TRANSACTION_MESSAGES = {
    "confirmed": ("Transaction Confirmed", "Your transaction of {moved} has been confirmed."),
    "failed": ("Transaction Failed", "Your transaction of {moved} has failed."),
}
TRANSACTION_UPDATED = ("Transaction Update", "Your transaction has been updated.")


def transaction_message(event_type: str, amount: Decimal, symbol: str) -> tuple[str, str]:
    title, body = TRANSACTION_MESSAGES.get(event_type, TRANSACTION_UPDATED)
    return title, body.format(moved=f"{format_amount(amount)} {symbol}")


class NotificationService:
    def __init__(self):
        self.expo_client = ExpoPushClient()

    def notify_user(
        self,
        user,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        notification_type: str = "general",
    ) -> Dict[str, Any]:

        prefs = UserPreferences.objects.filter(user_profile__user=user).first()

        Notification.objects.create(
            user=user,
            title=title,
            body=body,
            notification_type=notification_type,
            data=data or {},
        )

        if prefs and not prefs.can_receive_notification(notification_type):
            logger.info(f"Skipped for user {user.pk}: {notification_type} notifications disabled")
            return {
                "status": "skipped",
                "reason": f"{notification_type} notifications disabled",
                "sent": 0,
                "failed": 0,
            }

        device_tokens = list(DeviceToken.objects.filter(user=user, is_active=True))

        if not device_tokens:
            logger.info(f"No active devices for user {user.pk}")
            return {
                "status": "no_devices",
                "sent": 0,
                "failed": 0,
            }

        messages = []
        for token in device_tokens:
            messages.append(
                {
                    "to": token.push_token,
                    "title": title,
                    "body": body,
                    "data": data or {},
                    "sound": "default",
                }
            )

        try:
            results = self.expo_client.send_batch(messages)

            sent = sum(1 for r in results if r.get("status") == "ok")
            failed = len(results) - sent

            for i, result in enumerate(results):
                if result.get("status") == "error":
                    details = result.get("details", {})
                    error_type = details.get("error")

                    if error_type in ["DeviceNotRegistered", "InvalidCredentials"]:
                        token = device_tokens[i]
                        DeviceToken.objects.filter(pk=token.pk).update(is_active=False)
                        logger.info(f"Deactivated device token {token.pk} of user {user.pk}: {error_type}")

            logger.info(f"Sent to user {user.pk}: {sent} successful, {failed} failed")

            return {
                "status": "sent",
                "sent": sent,
                "failed": failed,
                "results": results,
            }

        except ExpoPushError as e:
            logger.error(f"Failed to send to user {user.pk}: {e}")
            return {
                "status": "error",
                "error": str(e),
                "sent": 0,
                "failed": len(messages),
            }

    def notify_transaction(
        self,
        user,
        transaction,
        event_type: str,
    ) -> Dict[str, Any]:
        title, body = transaction_message(
            event_type, transaction.amount, share_class_label(transaction) or transaction.asset.symbol
        )

        data = {
            "type": "transaction",
            "event": event_type,
            "transaction_id": str(transaction.uuid),
        }

        return self.notify_user(
            user=user,
            title=title,
            body=body,
            data=data,
            notification_type="transaction",
        )
