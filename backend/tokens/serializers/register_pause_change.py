from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import RegisterPauseChange, RegisterPauseChangeDecision
from tokens.serializers.register_capital_increase import (
    RegisterCapitalIncreaseTokenSnapshotSerializer,
)
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)
from tokens.serializers.register_deployment import (
    RegisterDeploymentCompanySnapshotSerializer,
    RegisterDeploymentTransactionSnapshotSerializer,
)


class RegisterPauseChangeCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token = serializers.UUIDField()
    paused = serializers.BooleanField()
    reason = serializers.CharField(max_length=1000)
    authority_reference = serializers.CharField(max_length=255)
    authority_evidence = serializers.UUIDField()

    def validate_paused(self, value):
        if type(self.initial_data.get("paused")) is not bool:
            raise serializers.ValidationError("The requested pause state must be a boolean.")
        return value


class RegisterPauseChangeSnapshotSerializer(serializers.Serializer):
    company = RegisterDeploymentCompanySnapshotSerializer()
    token = RegisterCapitalIncreaseTokenSnapshotSerializer()
    transaction = RegisterDeploymentTransactionSnapshotSerializer()


class RegisterPauseObservationSerializer(serializers.Serializer):
    block_number = serializers.IntegerField()
    block_hash = serializers.CharField()
    observed_at = serializers.DateTimeField()


class RegisterPauseChangeExecutionSerializer(serializers.Serializer):
    submission_id = serializers.UUIDField()
    paused = serializers.BooleanField()
    status = serializers.CharField()
    completed_at = serializers.DateTimeField(allow_null=True)
    operation_id = serializers.UUIDField(allow_null=True)
    claim_id = serializers.UUIDField(allow_null=True)
    operation_status = serializers.CharField(allow_null=True)
    tx_hash = serializers.CharField(allow_null=True)
    block_number = serializers.IntegerField(allow_null=True)
    block_hash = serializers.CharField(allow_null=True)
    gas_used = serializers.IntegerField(allow_null=True)
    observation = RegisterPauseObservationSerializer(allow_null=True)


class RegisterPauseChangeDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    snapshot = RegisterPauseChangeSnapshotSerializer()
    intent_digest = serializers.CharField()
    approval_decision = serializers.UUIDField(allow_null=True)
    paused = serializers.BooleanField()
    reason = serializers.CharField()
    authority_reference = serializers.CharField()


class RegisterPauseChangeDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterPauseChangeDecision


class RegisterPauseChangeSerializer(RegisterDecidedSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    snapshot = RegisterPauseChangeSnapshotSerializer(read_only=True)
    decisions = RegisterPauseChangeDecisionSerializer(many=True, read_only=True)
    execution = serializers.SerializerMethodField()
    execution_unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = RegisterPauseChange
        fields = [
            "uuid",
            "operation_id",
            "company",
            "token",
            "paused",
            "reason",
            "authority_reference",
            "authority_evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
            "snapshot",
            "intent_digest",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "approval_decision",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
            "execution",
            "execution_unmet_requirements",
        ]
        read_only_fields = fields

    @extend_schema_field(RegisterPauseChangeExecutionSerializer(allow_null=True))
    def get_execution(self, obj):
        from tokens.services.register_pause_changes import execution_receipt

        receipt = execution_receipt(obj)
        return RegisterPauseChangeExecutionSerializer(receipt).data if receipt is not None else None

    def get_execution_unmet_requirements(self, obj) -> list[str]:
        from tokens.services.register_pause_changes import execution_requirements

        return execution_requirements(obj)


class RegisterPauseChangeDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterPauseChangeDecideSerializer(RegisterDecideSerializer):
    pass
