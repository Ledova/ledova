from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from authentication.services.terms import TERMS_VERSION, current_terms_receipt
from users.models.user_profile import UserProfile

SIGNUP_IS_COMPLETE = "Sign-up cannot be reopened once it is complete."


class TermsAcceptanceSerializer(serializers.Serializer):
    version = serializers.CharField(read_only=True)
    statement = serializers.CharField(read_only=True)
    accepted_at = serializers.DateTimeField(source="created_at", read_only=True)


class UserProfileSerializer(serializers.ModelSerializer):
    uuid = serializers.CharField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    is_active = serializers.SerializerMethodField()
    is_staff = serializers.SerializerMethodField()
    date_joined = serializers.SerializerMethodField()
    last_login = serializers.SerializerMethodField()
    terms_version = serializers.ChoiceField(choices=[TERMS_VERSION], write_only=True, required=False)
    terms_acceptance = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = (
            "uuid",
            "full_name",
            "email",
            "is_active",
            "is_staff",
            "date_joined",
            "last_login",
            "residential_address",
            "terms_and_conditions",
            "terms_version",
            "terms_acceptance",
            "is_signup_completed",
        )
        read_only_fields = ("uuid",)

    @extend_schema_field(serializers.BooleanField())
    def get_is_active(self, obj):
        return obj.user.is_active if obj.user else None

    @extend_schema_field(serializers.BooleanField())
    def get_is_staff(self, obj):
        return obj.user.is_staff if obj.user else None

    @extend_schema_field(serializers.DateTimeField())
    def get_date_joined(self, obj):
        return obj.user.date_joined if obj.user else None

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_last_login(self, obj):
        return obj.user.last_login if obj.user else None

    @extend_schema_field(TermsAcceptanceSerializer(allow_null=True))
    def get_terms_acceptance(self, obj):
        request = self.context.get("request")
        receipt = current_terms_receipt(obj.user_id, request.user) if request is not None else None
        return TermsAcceptanceSerializer(receipt).data if receipt is not None else None

    def validate_is_signup_completed(self, value):
        if self.instance is not None and self.instance.is_signup_completed and not value:
            raise serializers.ValidationError(SIGNUP_IS_COMPLETE)
        return value

    def validate(self, attrs):
        if "email" in self.initial_data:
            raise serializers.ValidationError({"email": ["Email cannot be changed through a profile update."]})
        accepting = "terms_version" in attrs or attrs.get("terms_and_conditions") is True
        completing = attrs.get("is_signup_completed") is True and not getattr(
            self.instance, "is_signup_completed", False
        )
        if accepting or completing:
            if attrs.get("terms_version") != TERMS_VERSION or attrs.get("terms_and_conditions") is not True:
                raise serializers.ValidationError({"terms_and_conditions": ["Accept the current Terms of Service."]})
        return super().validate(attrs)
