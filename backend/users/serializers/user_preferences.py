from rest_framework import serializers

from users.models import UserAccount, UserPreferences


class AccountSummarySerializer(serializers.ModelSerializer):

    class Meta:
        model = UserAccount
        fields = ("uuid", "account_number", "account_type", "activation_date", "role")
        read_only_fields = fields


class UserPreferencesSerializer(serializers.ModelSerializer):

    user_profile = serializers.PrimaryKeyRelatedField(read_only=True)
    user_account = AccountSummarySerializer(source="user_profile.user_account", read_only=True)

    class Meta:
        model = UserPreferences
        exclude = ("created_at", "updated_at")
