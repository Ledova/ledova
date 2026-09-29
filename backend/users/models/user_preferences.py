from django.db import models

from shared.models.base import BaseModel


class UserPreferences(BaseModel):
    user_profile = models.OneToOneField("users.UserProfile", on_delete=models.CASCADE, related_name="preferences")
    transaction_alerts = models.BooleanField(default=True, help_text="Notifications for transaction status changes")

    class Meta:
        verbose_name_plural = "User Preferences"

    def __str__(self):
        return f"{self.user_profile.user.email} - Preferences"

    def can_receive_notification(self, notification_type: str) -> bool:
        if notification_type == "transaction":
            return self.transaction_alerts
        return True
