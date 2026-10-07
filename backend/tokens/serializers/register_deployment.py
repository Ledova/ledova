from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import RegisterDeployment, RegisterDeploymentDecision
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterDeploymentCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token = serializers.UUIDField()


class RegisterDeploymentCompanySnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    acn = serializers.CharField()
    status = serializers.CharField()


class RegisterDeploymentTokenSnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    symbol = serializers.CharField()
    identifier = serializers.CharField()
    authorised_shares = serializers.CharField()
    decimals = serializers.IntegerField()


class RegisterDeploymentWalletSnapshotSerializer(serializers.Serializer):
    address = serializers.CharField()
    chain = serializers.CharField()


class RegisterDeploymentRegisterSnapshotSerializer(serializers.Serializer):
    present = serializers.BooleanField()
    initialized = serializers.BooleanField(allow_null=True)
    uuid = serializers.UUIDField(allow_null=True)
    sequence = serializers.IntegerField(allow_null=True)
    head_hash = serializers.CharField(allow_null=True)
    issued_supply = serializers.CharField(allow_null=True)


class RegisterDeploymentTransactionSnapshotSerializer(serializers.Serializer):
    chain_id = serializers.IntegerField()
    sender = serializers.CharField()
    to = serializers.CharField()
    value = serializers.CharField()
    data = serializers.CharField()


class RegisterDeploymentSnapshotSerializer(serializers.Serializer):
    company = RegisterDeploymentCompanySnapshotSerializer()
    token = RegisterDeploymentTokenSnapshotSerializer()
    issuer_wallet = RegisterDeploymentWalletSnapshotSerializer()
    register = RegisterDeploymentRegisterSnapshotSerializer()
    transaction = RegisterDeploymentTransactionSnapshotSerializer()


class RegisterDeploymentExecutionSerializer(serializers.Serializer):
    deployment = serializers.UUIDField()
    operation_id = serializers.UUIDField(allow_null=True)
    claim_id = serializers.UUIDField(allow_null=True)
    operation_status = serializers.CharField(allow_null=True)
    tx_hash = serializers.CharField(allow_null=True)
    contract_address = serializers.CharField(allow_null=True)
    attribution_required = serializers.BooleanField()
    projected_at = serializers.DateTimeField(allow_null=True)
    swap_approval_outcome = serializers.CharField(allow_null=True)


class RegisterDeploymentDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    snapshot = RegisterDeploymentSnapshotSerializer()
    intent_digest = serializers.CharField()
    deployment_id = serializers.UUIDField(allow_null=True)
    approval_decision = serializers.UUIDField(allow_null=True)


class RegisterDeploymentDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterDeploymentDecision


class RegisterDeploymentSerializer(RegisterDecidedSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    snapshot = RegisterDeploymentSnapshotSerializer(read_only=True)
    decisions = RegisterDeploymentDecisionSerializer(many=True, read_only=True)
    execution = serializers.SerializerMethodField()
    execution_unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = RegisterDeployment
        fields = [
            "uuid",
            "operation_id",
            "company",
            "token",
            "snapshot",
            "intent_digest",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "approval_decision",
            "deployment_id",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
            "execution",
            "execution_unmet_requirements",
        ]
        read_only_fields = fields

    @extend_schema_field(RegisterDeploymentExecutionSerializer(allow_null=True))
    def get_execution(self, obj):
        from tokens.services.register_deployments import execution_receipt

        receipt = execution_receipt(obj)
        return RegisterDeploymentExecutionSerializer(receipt).data if receipt is not None else None

    def get_execution_unmet_requirements(self, obj) -> list[str]:
        from tokens.services.register_deployments import execution_requirements

        return execution_requirements(obj)


class RegisterDeploymentDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterDeploymentDecideSerializer(RegisterDecideSerializer):
    pass
