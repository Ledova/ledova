from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import RegisterParticularsChange, RegisterParticularsChangeDecision
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterParticularsChangeCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    member = serializers.UUIDField()
    supporting_evidence = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    residential_address = serializers.CharField(max_length=REGISTER_IMPORT_ADDRESS_LENGTH)
    as_at = serializers.DateField()
    reason = serializers.CharField(max_length=1000)


class RegisterParticularsChangeDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterParticularsChangeDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterParticularsHeldSerializer(serializers.Serializer):
    name = serializers.CharField()
    residential_address = serializers.CharField()
    as_at = serializers.DateField()
    source_import = serializers.UUIDField(allow_null=True)
    source_change = serializers.UUIDField(allow_null=True)


class RegisterParticularsChangeDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    member = serializers.UUIDField()
    name = serializers.CharField()
    residential_address = serializers.CharField()
    as_at = serializers.DateField()
    current = RegisterParticularsHeldSerializer(allow_null=True)


class RegisterParticularsChangeDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterParticularsChangeDecision


class RegisterParticularsChangeSerializer(RegisterDecidedSerializer):
    decisions = RegisterParticularsChangeDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = RegisterParticularsChange
        fields = [
            "uuid",
            "company",
            "member",
            "name",
            "residential_address",
            "as_at",
            "reason",
            "evidence_fingerprint",
            "evidence_snapshot",
            "supporting_evidence",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
        ]
        read_only_fields = fields
