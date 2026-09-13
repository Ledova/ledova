from rest_framework import serializers

from portfolios.models.portfolio import Portfolio
from users.models import UserAccount, UserPreferences


class AccountSummarySerializer(serializers.ModelSerializer):

    class Meta:
        model = UserAccount
        fields = ("uuid", "account_number", "account_type", "activation_date", "role")
        read_only_fields = fields


class SelectedPortfolioSerializer(serializers.ModelSerializer):

    user_account = serializers.UUIDField(source="user_account.uuid", read_only=True)

    class Meta:
        model = Portfolio
        fields = ("uuid", "user_account", "name", "is_active")
        read_only_fields = fields


class UserPreferencesSerializer(serializers.ModelSerializer):

    user_profile = serializers.PrimaryKeyRelatedField(read_only=True)
    user_account = AccountSummarySerializer(source="user_profile.user_account", read_only=True)
    selected_portfolio = serializers.PrimaryKeyRelatedField(
        required=False, allow_null=True, queryset=Portfolio.objects.none()
    )

    class Meta:
        model = UserPreferences
        exclude = ("created_at", "updated_at")

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")

        if request and request.user:
            user_profile = getattr(request.user, "userprofile", None)
            account = getattr(user_profile, "user_account", None) if user_profile else None
            if account:
                fields["selected_portfolio"].queryset = Portfolio.objects.filter(user_account=account)

        return fields

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        still_visible = Portfolio.objects.filter(
            pk=instance.selected_portfolio_id, user_account=instance.user_profile.user_account
        ).first()
        representation["selected_portfolio"] = (
            SelectedPortfolioSerializer(still_visible).data if still_visible else None
        )

        return representation
