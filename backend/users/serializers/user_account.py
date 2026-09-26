from rest_framework import serializers

from users.models import UserAccount
from users.models.user_account import AccountRole

ROLE_IS_SET = "Role cannot be changed after sign-up is complete."
BOTH_IS_SET_BY_STAFF = "Only staff can give an account both roles."


class UserAccountSerializer(serializers.ModelSerializer):
    uuid = serializers.CharField(read_only=True)

    class Meta:
        model = UserAccount
        fields = (
            "uuid",
            "account_number",
            "account_type",
            "activation_date",
            "role",
        )
        read_only_fields = (
            "uuid",
            "account_number",
            "activation_date",
        )

    def validate_role(self, value):
        if value == self.instance.role:
            return value
        if self.instance.user_profile.is_signup_completed:
            raise serializers.ValidationError(ROLE_IS_SET)
        if value == AccountRole.BOTH:
            raise serializers.ValidationError(BOTH_IS_SET_BY_STAFF)
        return value
