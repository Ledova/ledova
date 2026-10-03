from django.urls import reverse
from rest_framework import serializers

from companies.models import CompanyAuthorityRequest, CompanyCapability, CompanyType

VERIFICATION_UNAVAILABLE = (
    "Evidence received and awaiting independent verification. Company authority verification is unavailable; "
    "this request grants no company authority."
)
WITHDRAWN_MESSAGE = (
    "Request withdrawn. Its evidence and original terms remain retained and accessible; "
    "company authority verification is unavailable, and this request grants no company authority."
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
    status = serializers.ChoiceField(choices=["pending", "withdrawn"], read_only=True)
    withdrawn_at = serializers.DateTimeField(
        source="withdrawal.created_at", read_only=True, allow_null=True, default=None
    )
    verification_status = serializers.ChoiceField(choices=["unavailable"], read_only=True, default="unavailable")
    verification_message = serializers.SerializerMethodField()
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
        ]
        read_only_fields = fields

    def get_file_url(self, obj) -> str:
        url = reverse("company-authority:requests-file", kwargs={"uuid": obj.pk})
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def get_verification_message(self, obj) -> str:
        return WITHDRAWN_MESSAGE if obj.status == "withdrawn" else VERIFICATION_UNAVAILABLE
