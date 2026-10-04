from collections.abc import Mapping

from django.urls import reverse
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from companies.models import (
    CompanyAppointment,
    CompanyAuthorityRequest,
    CompanyCapability,
    CompanyType,
)
from companies.services.authority import (
    DECLARATION_VERSION,
    is_company_appointment_effective,
)

VERIFICATION_UNAVAILABLE = (
    "Evidence retained. Accept the company authorisation declaration to establish initial authority after "
    "the required identity and ABR company checks pass. This pending request grants no company authority."
)
WITHDRAWN_MESSAGE = (
    "Request withdrawn. Its evidence and original terms remain retained and accessible; "
    "this request grants no company authority. Submit a new request to declare company authorisation."
)


class CompanyAuthorityRequestUploadSerializer(serializers.Serializer):
    company = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    file = serializers.FileField()
    requested_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), required=False, default=list
    )
    delegatable_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), required=False, default=list
    )
    requested_expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"non_field_errors": ["Submit the declaration as an object."]})
        unexpected = set(data) - set(self.fields)
        if unexpected:
            raise serializers.ValidationError({key: "This field cannot be submitted." for key in sorted(unexpected)})
        return super().to_internal_value(data)


class AuthorityCompanyIdentitySnapshotSerializer(serializers.Serializer):
    name = serializers.CharField(allow_blank=True)
    acn = serializers.CharField(allow_blank=True)
    abn = serializers.CharField(allow_blank=True)
    company_type = serializers.ChoiceField(choices=CompanyType.choices)


class CompanyAuthorityRequestWithdrawalSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if data:
            raise serializers.ValidationError(
                {"non_field_errors": ["Submit an empty object to withdraw your request."]}
            )
        return super().to_internal_value(data)


class CompanyAuthorityRequestAdmissionSerializer(serializers.Serializer):
    declaration_version = serializers.ChoiceField(choices=[DECLARATION_VERSION])
    accept_declaration = serializers.BooleanField()

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"non_field_errors": ["Submit the declaration as an object."]})
        unexpected = set(data) - set(self.fields)
        if unexpected:
            raise serializers.ValidationError({key: "This field cannot be submitted." for key in sorted(unexpected)})
        if data.get("accept_declaration") is not True:
            raise serializers.ValidationError({"accept_declaration": "Accept the company authorisation declaration."})
        return super().to_internal_value(data)


class CompanyAppointmentSerializer(serializers.ModelSerializer):
    is_effective = serializers.SerializerMethodField()
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )
    delegatable_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )
    revoked_at = serializers.DateTimeField(
        source="revocation.created_at", read_only=True, allow_null=True, default=None
    )
    status = serializers.ChoiceField(choices=["active", "expired", "revoked"], read_only=True)

    class Meta:
        model = CompanyAppointment
        fields = [
            "uuid",
            "capabilities",
            "delegatable_capabilities",
            "expires_at",
            "created_at",
            "revoked_at",
            "status",
            "is_effective",
            "declaration_version",
            "declaration_text",
        ]
        read_only_fields = fields

    def get_is_effective(self, obj) -> bool:
        return is_company_appointment_effective(obj)


class AuthorityPersonIdentitySnapshotSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    profile_uuid = serializers.UUIDField()
    email = serializers.EmailField()
    full_name = serializers.CharField(allow_blank=True)


class CompanyAuthorityRequestSerializer(serializers.ModelSerializer):
    company_identity_raw = AuthorityCompanyIdentitySnapshotSerializer(read_only=True)
    company_identity = AuthorityCompanyIdentitySnapshotSerializer(read_only=True)
    person_identity_raw = AuthorityPersonIdentitySnapshotSerializer(read_only=True)
    person_identity = AuthorityPersonIdentitySnapshotSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()
    status = serializers.ChoiceField(choices=["pending", "withdrawn", "admitted"], read_only=True)
    withdrawn_at = serializers.DateTimeField(
        source="withdrawal.created_at", read_only=True, allow_null=True, default=None
    )
    verification_status = serializers.SerializerMethodField()
    verification_message = serializers.SerializerMethodField()
    appointment = CompanyAppointmentSerializer(read_only=True, allow_null=True, default=None)
    requested_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )
    delegatable_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )

    class Meta:
        model = CompanyAuthorityRequest
        fields = [
            "uuid",
            "company",
            "requester_profile",
            "idempotency_key",
            "purpose",
            "company_identity_raw",
            "company_identity",
            "person_identity_raw",
            "person_identity",
            "requested_capabilities",
            "delegatable_capabilities",
            "requested_expires_at",
            "original_filename",
            "file_size",
            "mime_type",
            "file_sha256",
            "request_digest",
            "created_at",
            "file_url",
            "status",
            "withdrawn_at",
            "verification_status",
            "verification_message",
            "appointment",
        ]
        read_only_fields = fields

    def get_file_url(self, obj) -> str:
        url = reverse("company-authority:requests-file", kwargs={"uuid": obj.pk})
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def get_verification_message(self, obj) -> str:
        if obj.status == "admitted":
            active = is_company_appointment_effective(obj.appointment)
            return (
                "Authorisation declared by the company representative. Company information is provided by the company. "
                + ("Your company appointment is current." if active else "Your company appointment is not current.")
            )
        return WITHDRAWN_MESSAGE if obj.status == "withdrawn" else VERIFICATION_UNAVAILABLE

    @extend_schema_field(serializers.ChoiceField(choices=["unavailable", "self_declared"]))
    def get_verification_status(self, obj) -> str:
        return "self_declared" if obj.status == "admitted" else "unavailable"
