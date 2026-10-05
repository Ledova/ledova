from rest_framework import serializers

from tokens.models import (
    RegisterCorrection,
    RegisterCorrectionAuthority,
    RegisterCorrectionDecision,
)
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterCorrectionCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    corrects_id = serializers.UUIDField()
    authority_evidence = serializers.UUIDField()
    effective_on = serializers.DateField()
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterCorrectionDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterCorrectionDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterCorrectionChangeSerializer(serializers.Serializer):
    member = serializers.CharField()
    shares = serializers.CharField()


class RegisterCorrectionDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    register_sequence = serializers.IntegerField()
    original_changes = RegisterCorrectionChangeSerializer(many=True)
    changes = RegisterCorrectionChangeSerializer(many=True)
    effective_on = serializers.DateField()


class RegisterCorrectionDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterCorrectionDecision


class RegisterCorrectionSerializer(RegisterDecidedSerializer):
    decisions = RegisterCorrectionDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = RegisterCorrection
        fields = [
            "uuid",
            "company",
            "register",
            "corrects",
            "base_sequence",
            "base_hash",
            "effective_on",
            "changes",
            "authority",
            "approving_director",
            "authority_reference",
            "reason",
            "source_document",
            "evidence_fingerprint",
            "evidence_snapshot",
            "authority_evidence",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "applied_entry",
            "decisions",
            "created_at",
        ]
        read_only_fields = fields
