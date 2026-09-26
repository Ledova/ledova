from rest_framework import serializers

from users.models import NotificationPreferences


class NotificationPreferencesSerializer(serializers.ModelSerializer):
    user_profile = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = NotificationPreferences
        fields = (
            "uuid",
            "user_profile",
            "transaction_alerts",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("uuid", "user_profile", "created_at", "updated_at")
