from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import RegisterParticularsChange, RegisterParticularsChangeDecision
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecisionSerializer,
)


class RegisterParticularsExpectedSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, allow_blank=True, trim_whitespace=False)
    residential_address = serializers.CharField(
        max_length=REGISTER_IMPORT_ADDRESS_LENGTH, allow_blank=True, trim_whitespace=False
    )


class RegisterParticularsChangeCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    member = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    residential_address = serializers.CharField(max_length=REGISTER_IMPORT_ADDRESS_LENGTH)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    expected = RegisterParticularsExpectedSerializer()


class RegisterParticularsHeldSerializer(serializers.Serializer):
    name = serializers.CharField()
    residential_address = serializers.CharField()
    as_at = serializers.DateField()


class RegisterParticularsChangeDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterParticularsChangeDecision


class RegisterParticularsChangeSerializer(RegisterDecidedSerializer):
    decisions = RegisterParticularsChangeDecisionSerializer(many=True, read_only=True)
    previous_particulars = RegisterParticularsHeldSerializer(read_only=True, allow_null=True)
    submitted_by = serializers.SerializerMethodField()
    reviewed_by = serializers.SerializerMethodField()

    def get_provided_by(self, obj) -> str:
        return "member" if obj.member_association_id else super().get_provided_by(obj)

    def get_submitted_by(self, obj) -> int | None:
        return None if obj.member_association_id else obj.submitted_by_id

    def get_reviewed_by(self, obj) -> int | None:
        return None if obj.member_association_id else obj.reviewed_by_id

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
            "previous_particulars",
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
