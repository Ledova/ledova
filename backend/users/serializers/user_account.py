from rest_framework import serializers

from users.models import UserAccount

ROLE_IS_SET = "Role cannot be changed after sign-up is complete."


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
        if self.instance.user_profile.is_signup_completed and value != self.instance.role:
            raise serializers.ValidationError(ROLE_IS_SET)
        return value
