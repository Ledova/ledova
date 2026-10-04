from collections.abc import Mapping

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from companies.models import (
    CompanyAppointment,
    CompanyCapability,
    CompanyTeamInvitation,
)
from companies.serializers.authority_request import (
    CompanyAppointmentSerializer,
    CompanyAuthorityRequestAdmissionSerializer,
)


class StrictTeamSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"non_field_errors": ["Submit an object."]})
        unexpected = set(data) - set(self.fields)
        if unexpected:
            raise serializers.ValidationError({key: "This field cannot be submitted." for key in sorted(unexpected)})
        return super().to_internal_value(data)


class CompanyTeamInvitationCreateSerializer(StrictTeamSerializer):
    company = serializers.UUIDField()
    inviter_appointment = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    capabilities = serializers.ListField(child=serializers.ChoiceField(choices=CompanyCapability.choices))
    delegatable_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), required=False, default=list
    )
    acceptance_deadline = serializers.DateTimeField(required=False, allow_null=True, default=None)
    appointment_expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)


class CompanyTeamInvitationAcceptSerializer(CompanyAuthorityRequestAdmissionSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{43}$", trim_whitespace=False, write_only=True)


class CompanyTeamQuerySerializer(StrictTeamSerializer):
    company = serializers.UUIDField()


class CompanyAppointmentRevokeSerializer(StrictTeamSerializer):
    pass


class CompanyTeamInvitationSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(read_only=True)
    accepted_at = serializers.DateTimeField(
        source="appointment.created_at", read_only=True, allow_null=True, default=None
    )
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )
    delegatable_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CompanyCapability.choices), read_only=True
    )

    class Meta:
        model = CompanyTeamInvitation
        fields = [
            "uuid",
            "company",
            "company_name",
            "inviter_appointment",
            "idempotency_key",
            "capabilities",
            "delegatable_capabilities",
            "acceptance_deadline",
            "appointment_expires_at",
            "created_at",
            "accepted_at",
        ]
        read_only_fields = fields


class CompanyTeamInvitationIssuedSerializer(CompanyTeamInvitationSerializer):
    code = serializers.CharField(read_only=True, allow_null=True)

    class Meta(CompanyTeamInvitationSerializer.Meta):
        fields = [*CompanyTeamInvitationSerializer.Meta.fields, "code"]
        read_only_fields = fields


class OwnCompanyAppointmentSerializer(CompanyAppointmentSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)
    source = serializers.SerializerMethodField()

    class Meta(CompanyAppointmentSerializer.Meta):
        fields = [*CompanyAppointmentSerializer.Meta.fields, "company", "company_name", "source"]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=["initial", "invitation", "legacy_owner"]))
    def get_source(self, obj) -> str:
        if obj.request_id:
            return "initial"
        return "legacy_owner" if obj.legacy_owner_id else "invitation"


class CompanyTeamAppointmentSerializer(OwnCompanyAppointmentSerializer):
    name = serializers.CharField(source="appointee_profile.full_name", read_only=True, allow_blank=True)
    email = serializers.EmailField(source="appointee.email", read_only=True)

    class Meta:
        model = CompanyAppointment
        fields = [
            "uuid",
            "company",
            "name",
            "email",
            "capabilities",
            "delegatable_capabilities",
            "expires_at",
            "created_at",
            "revoked_at",
            "status",
            "is_effective",
            "source",
        ]
        read_only_fields = fields
