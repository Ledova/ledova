from django.contrib.auth import get_user_model
from django.core.validators import RegexValidator
from rest_framework import serializers

from authentication.serializers.fields import NormalizedEmailField

User = get_user_model()
PASSWORD_PRESENT = RegexValidator(r"\S", message="Password may not be blank.")


def _identity(instance):
    return {
        "uuid": str(instance.userprofile.uuid) if hasattr(instance, "userprofile") else None,
        "email": instance.email,
        "is_email_verified": instance.is_email_verified,
    }


class EmailVerificationSerializer(serializers.Serializer):
    token = serializers.CharField(required=True)
    email = NormalizedEmailField(required=True)

    def to_representation(self, instance):
        return _identity(instance)


class UserSignupSerializer(serializers.Serializer):
    email = NormalizedEmailField(required=True)
    password = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )
    password_confirm = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )

    def validate_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters long.")
        return value

    def to_representation(self, instance):
        return _identity(instance)


class UserSigninSerializer(serializers.Serializer):
    email = NormalizedEmailField(required=True)
    password = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )

    def to_representation(self, instance):
        return _identity(instance)


class ResendVerificationSerializer(serializers.Serializer):
    email = NormalizedEmailField(required=False)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = NormalizedEmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64, write_only=True)
    token = serializers.CharField(max_length=100, write_only=True)
    new_password = serializers.CharField(
        max_length=255,
        write_only=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )


class SignupRestartSerializer(serializers.Serializer):
    email = NormalizedEmailField(required=True)
    current_password = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )

    def to_representation(self, instance):
        return _identity(instance)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )
    new_password = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )
    new_password_confirm = serializers.CharField(
        max_length=255,
        write_only=True,
        required=True,
        trim_whitespace=False,
        validators=[PASSWORD_PRESENT],
        style={"input_type": "password"},
    )

    def validate_new_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters long.")
        return value

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": "New passwords do not match."})

        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "New password must be different from current password."})

        return attrs
