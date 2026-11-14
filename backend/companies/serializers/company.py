from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from companies.models import Company, CompanyCapability
from companies.services.administration import (
    company_administrative_access,
    company_contact,
)
from companies.services.company import register_company
from companies.services.editing import update_company
from companies.validators import (
    an_acn_no_other_company_holds,
    checked_abn,
    with_matching_identifiers,
)
from wallets.models import Wallet


class _CompanyUserProfileSerializer(serializers.Serializer):

    full_name = serializers.CharField(read_only=True, allow_null=True)


class _CompanyUserProfileCreateSerializer(serializers.Serializer):

    first_name = serializers.CharField(max_length=100, required=True)
    last_name = serializers.CharField(max_length=100, required=True)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)


class CompanyAdministrativeAccessSerializer(serializers.Serializer):
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )
    draft_setup = serializers.BooleanField(read_only=True)


class _CompanyAdministrativeSerializer(serializers.ModelSerializer):
    is_owner = serializers.SerializerMethodField()
    administrative_access = serializers.SerializerMethodField()

    def get_is_owner(self, obj) -> bool:
        actor = getattr(self.context.get("request"), "user", None)
        return bool(actor and actor.is_authenticated and obj.owner_id == actor.pk)

    @extend_schema_field(CompanyAdministrativeAccessSerializer)
    def get_administrative_access(self, obj):
        return company_administrative_access(obj, getattr(self.context.get("request"), "user", None))


class CompanyListSerializer(_CompanyAdministrativeSerializer):

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    company_type_display = serializers.CharField(
        source="get_company_type_display",
        read_only=True,
    )

    class Meta:
        model = Company
        fields = [
            "uuid",
            "name",
            "trading_name",
            "display_name",
            "acn",
            "company_type",
            "company_type_display",
            "status",
            "status_display",
            "industry",
            "city",
            "state",
            "is_active",
            "created_at",
            "is_owner",
            "administrative_access",
        ]
        read_only_fields = fields


class CompanyDetailSerializer(_CompanyAdministrativeSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    company_type_display = serializers.CharField(
        source="get_company_type_display",
        read_only=True,
    )
    email = serializers.SerializerMethodField()
    primary_contact = serializers.SerializerMethodField()

    @extend_schema_field(serializers.EmailField(allow_null=True))
    def get_email(self, obj):
        actor = getattr(self.context.get("request"), "user", None)
        if actor is None:
            return obj.email
        contact = company_contact(obj, actor)
        return contact["email"] if contact else None

    operator_wallet = serializers.UUIDField(source="operator_wallet_id", allow_null=True, read_only=True)

    @extend_schema_field(_CompanyUserProfileSerializer(allow_null=True))
    def get_primary_contact(self, obj):
        actor = getattr(self.context.get("request"), "user", None)
        if actor is None:
            return _CompanyUserProfileSerializer(obj.primary_contact).data if obj.primary_contact else None
        contact = company_contact(obj, actor)
        profile = contact["primary_contact"] if contact else None
        return _CompanyUserProfileSerializer(profile).data if profile is not None else None

    class Meta:
        model = Company
        fields = [
            "uuid",
            "name",
            "trading_name",
            "display_name",
            "company_type",
            "company_type_display",
            "acn",
            "abn",
            "status",
            "status_display",
            "email",
            "phone",
            "address_line_1",
            "address_line_2",
            "city",
            "state",
            "postcode",
            "country",
            "operator_wallet",
            "activated_at",
            "description",
            "industry",
            "founded_year",
            "is_active",
            "can_issue_tokens",
            "share_ownership_with_members",
            "ownership_sharing_changed_by",
            "ownership_sharing_changed_at",
            "primary_contact",
            "created_at",
            "updated_at",
            "is_owner",
            "administrative_access",
        ]
        read_only_fields = [
            "uuid",
            "status",
            "email",
            "activated_at",
            "is_active",
            "can_issue_tokens",
            "created_at",
            "updated_at",
            "share_ownership_with_members",
            "ownership_sharing_changed_by",
            "ownership_sharing_changed_at",
        ]


class CompanyRegistrationSerializer(serializers.ModelSerializer):

    primary_contact = _CompanyUserProfileCreateSerializer(write_only=True, required=True)

    class Meta:
        model = Company
        fields = [
            "name",
            "trading_name",
            "company_type",
            "acn",
            "abn",
            "primary_contact",
        ]

    def validate_acn(self, value):
        return an_acn_no_other_company_holds(value)

    def validate_abn(self, value):
        return checked_abn(value)

    def validate(self, data):
        return with_matching_identifiers(self, data)

    def create(self, validated_data):
        contact_data = validated_data.pop("primary_contact")
        user = self.context["request"].user

        return register_company(owner=user, primary_contact_data=contact_data, **validated_data)


class CompanyUpdateSerializer(serializers.ModelSerializer):

    operator_wallet = serializers.SlugRelatedField(
        slug_field="uuid", queryset=Wallet.objects.none(), required=False, allow_null=True
    )

    class Meta:
        model = Company
        fields = [
            "name",
            "trading_name",
            "company_type",
            "acn",
            "abn",
            "address_line_1",
            "address_line_2",
            "city",
            "state",
            "postcode",
            "phone",
            "description",
            "industry",
            "operator_wallet",
            "share_ownership_with_members",
        ]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        fields["operator_wallet"].queryset = Wallet.objects.owned_by(getattr(request, "user", None)).verified_evm()
        return fields

    def validate_acn(self, value):
        return an_acn_no_other_company_holds(value, other_than=self.instance)

    def validate_abn(self, value):
        return checked_abn(value)

    def validate(self, data):
        return with_matching_identifiers(self, data)

    def update(self, instance, validated_data):
        return update_company(instance, validated_data, actor=self.context["request"].user)
