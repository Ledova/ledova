from collections.abc import Mapping
from uuid import UUID

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityDecisionOutcome,
    CompanyEligibilityRequest,
    CompanyEligibilityRequestWithdrawal,
    CompanyEligibilityRevocation,
)
from users.models.investor_classification import CertifierBody, InvestorCategory
from users.services.company_eligibility import request_outcome

REQUEST_OUTCOME_CHOICES = ["pending", "accepted", "refused", "withdrawn", "revoked", "expired"]


class CompanyEligibilityUUIDField(serializers.UUIDField):
    def to_internal_value(self, data):
        if not isinstance(data, (str, UUID)):
            self.fail("invalid")
        return super().to_internal_value(data)


class CompanyEligibilityQuantityField(serializers.IntegerField):
    def to_internal_value(self, data):
        if type(data) is not int:
            self.fail("invalid")
        return super().to_internal_value(data)


class CompanyEligibilityReasonField(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class CompanyEligibilityInputSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"non_field_errors": ["Submit an object."]})
        unexpected = set(data) - set(self.fields)
        if unexpected:
            raise serializers.ValidationError({key: "This field cannot be submitted." for key in sorted(unexpected)})
        return super().to_internal_value(data)


class CompanyEligibilityRequestPreviewSerializer(CompanyEligibilityInputSerializer):
    source = CompanyEligibilityUUIDField()
    company = CompanyEligibilityUUIDField(required=False, allow_null=True, default=None)
    offering = CompanyEligibilityUUIDField(required=False, allow_null=True, default=None)
    quantity = CompanyEligibilityQuantityField(
        min_value=1, max_value=2147483647, required=False, allow_null=True, default=None
    )
    requested_expires_at = serializers.DateTimeField()

    def validate(self, data):
        company = data["company"]
        offering = data["offering"]
        quantity = data["quantity"]
        if company is not None and offering is None and quantity is None:
            return data
        if company is None and offering is not None and quantity is not None:
            return data
        raise serializers.ValidationError("Select one company or an exact offering and whole-share quantity.")


class CompanyEligibilityRequestCreateSerializer(CompanyEligibilityRequestPreviewSerializer):
    preview_digest = serializers.RegexField(r"^[0-9a-f]{64}$", trim_whitespace=False)
    idempotency_key = CompanyEligibilityUUIDField()
    sharing_accepted = serializers.BooleanField()
    declaration_accepted = serializers.BooleanField()

    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            confirmations = {
                key: "Confirm the exact declaration and sharing summary."
                for key in ("sharing_accepted", "declaration_accepted")
                if data.get(key) is not True
            }
            if confirmations:
                raise serializers.ValidationError(confirmations)
        return super().to_internal_value(data)


class CompanyEligibilityDecisionPreviewSerializer(CompanyEligibilityInputSerializer):
    appointment = CompanyEligibilityUUIDField()
    outcome = serializers.ChoiceField(choices=CompanyEligibilityDecisionOutcome.choices)
    expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    reason = CompanyEligibilityReasonField(
        max_length=500, required=False, allow_blank=True, default="", trim_whitespace=False
    )

    def validate(self, data):
        if data["outcome"] == CompanyEligibilityDecisionOutcome.ACCEPTED:
            if data["expires_at"] is None:
                raise serializers.ValidationError({"expires_at": "Set the expiry of the exact acceptance."})
            if data["reason"]:
                raise serializers.ValidationError({"reason": "An acceptance does not include a refusal reason."})
        elif data["expires_at"] is not None or not data["reason"].strip():
            raise serializers.ValidationError("A refusal requires a reason and no expiry.")
        return data


class CompanyEligibilityDecisionCreateSerializer(CompanyEligibilityDecisionPreviewSerializer):
    preview_digest = serializers.RegexField(r"^[0-9a-f]{64}$", trim_whitespace=False)
    idempotency_key = CompanyEligibilityUUIDField()
    confirmation = serializers.BooleanField()

    def to_internal_value(self, data):
        if isinstance(data, Mapping) and data.get("confirmation") is not True:
            raise serializers.ValidationError({"confirmation": "Confirm the exact company decision."})
        return super().to_internal_value(data)


class CompanyEligibilityRequestWithdrawalCreateSerializer(CompanyEligibilityInputSerializer):
    idempotency_key = CompanyEligibilityUUIDField()


class CompanyEligibilityRevocationCreateSerializer(CompanyEligibilityInputSerializer):
    appointment = CompanyEligibilityUUIDField()
    idempotency_key = CompanyEligibilityUUIDField()
    reason = CompanyEligibilityReasonField(max_length=500, trim_whitespace=False)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A bounded revocation reason is required.")
        return value


class CompanyEligibilitySharedSummarySerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=InvestorCategory.choices)
    declaration_text = serializers.CharField(allow_blank=True)
    source = serializers.UUIDField()
    user_account = serializers.UUIDField()
    company = serializers.UUIDField()
    submitted_at = serializers.DateTimeField(allow_null=True)
    requested_expires_at = serializers.DateTimeField()
    certificate_issued_at = serializers.DateField(required=False, allow_null=True)
    certifier_name = serializers.CharField(required=False, allow_blank=True)
    certifier_body = serializers.ChoiceField(choices=CertifierBody.choices, required=False, allow_blank=True)
    certifier_membership_number = serializers.CharField(required=False, allow_blank=True)
    associated_company = serializers.UUIDField(required=False, allow_null=True)
    offering = serializers.UUIDField(required=False)
    token = serializers.UUIDField(required=False)
    quantity = serializers.IntegerField(required=False)
    price_per_share = serializers.DecimalField(max_digits=18, decimal_places=2, required=False)
    price_currency = serializers.CharField(required=False)
    amount_aud = serializers.DecimalField(max_digits=None, decimal_places=2, required=False)
    offering_terms = serializers.JSONField(required=False)
    offering_terms_digest = serializers.CharField(required=False)

    def to_representation(self, instance):
        return {key: value for key, value in super().to_representation(instance).items() if key in instance}


class CompanyEligibilityRequestPreviewResultSerializer(serializers.Serializer):
    version = serializers.CharField()
    shared_summary = CompanyEligibilitySharedSummarySerializer()
    source_fingerprint = serializers.CharField(allow_null=True)
    evidence_hash = serializers.CharField(allow_null=True)
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_submit = serializers.BooleanField()


class CompanyEligibilityDecisionPreviewResultSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()


class CompanyEligibilityRevocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyEligibilityRevocation
        fields = [
            "uuid",
            "revoked_by",
            "appointment",
            "idempotency_key",
            "digest",
            "reason",
            "revoked_at",
        ]
        read_only_fields = fields


class CompanyEligibilityRequestWithdrawalSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyEligibilityRequestWithdrawal
        fields = ["uuid", "withdrawn_by", "idempotency_key", "digest", "withdrawn_at"]
        read_only_fields = fields


class CompanyEligibilityDecisionSerializer(serializers.ModelSerializer):
    revocation = CompanyEligibilityRevocationSerializer(read_only=True, allow_null=True, default=None)

    class Meta:
        model = CompanyEligibilityDecision
        fields = [
            "uuid",
            "decided_by",
            "appointment",
            "idempotency_key",
            "request_digest",
            "digest",
            "outcome",
            "decided_at",
            "expires_at",
            "reason",
            "revocation",
        ]
        read_only_fields = fields


class CompanyEligibilityRequestSerializer(serializers.ModelSerializer):
    shared_summary = CompanyEligibilitySharedSummarySerializer(read_only=True)
    outcome = serializers.SerializerMethodField()
    decision = CompanyEligibilityDecisionSerializer(read_only=True, allow_null=True, default=None)
    withdrawal = CompanyEligibilityRequestWithdrawalSerializer(read_only=True, allow_null=True, default=None)

    class Meta:
        model = CompanyEligibilityRequest
        fields = [
            "uuid",
            "user_account",
            "company",
            "source",
            "submitted_by",
            "idempotency_key",
            "version",
            "category",
            "shared_summary",
            "source_fingerprint",
            "evidence_hash",
            "digest",
            "requested_expires_at",
            "submitted_at",
            "outcome",
            "decision",
            "withdrawal",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=REQUEST_OUTCOME_CHOICES))
    def get_outcome(self, obj) -> str:
        return request_outcome(obj)
