from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import RegisterCapitalIncrease, RegisterCapitalIncreaseDecision
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


class RegisterCapitalIncreaseCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token = serializers.UUIDField()
    additional_shares = serializers.IntegerField(min_value=1, max_value=2147483647)
    new_authorized_total = serializers.IntegerField(min_value=1, max_value=2147483647)
    purpose = serializers.CharField()
    board_resolution_reference = serializers.CharField(max_length=255)
    shareholder_approval_reference = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_evidence = serializers.UUIDField()


class RegisterCapitalIncreaseTokenSnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    symbol = serializers.CharField()
    chain = serializers.CharField()
    contract_address = serializers.CharField()
    authorised_shares = serializers.CharField()
    decimals = serializers.IntegerField()


class RegisterCapitalIncreaseTermsSnapshotSerializer(serializers.Serializer):
    prior_authorized_total = serializers.CharField()
    additional_shares = serializers.CharField()
    new_authorized_total = serializers.CharField()
    purpose = serializers.CharField()
    board_resolution_reference = serializers.CharField()
    shareholder_approval_reference = serializers.CharField()


class RegisterCapitalIncreaseSnapshotSerializer(serializers.Serializer):
    company = RegisterDeploymentCompanySnapshotSerializer()
    token = RegisterCapitalIncreaseTokenSnapshotSerializer()
    capital = RegisterCapitalIncreaseTermsSnapshotSerializer()
    transaction = RegisterDeploymentTransactionSnapshotSerializer()


class RegisterCapitalIncreaseExecutionSerializer(serializers.Serializer):
    execution = serializers.UUIDField()
    request = serializers.UUIDField()
    dispatch_id = serializers.UUIDField()
    status = serializers.CharField()
    operation_id = serializers.UUIDField(allow_null=True)
    claim_id = serializers.UUIDField(allow_null=True)
    operation_status = serializers.CharField(allow_null=True)
    transaction = serializers.UUIDField(allow_null=True)
    tx_hash = serializers.CharField(allow_null=True)
    block_number = serializers.IntegerField(allow_null=True)
    block_hash = serializers.CharField(allow_null=True)
    gas_used = serializers.IntegerField(allow_null=True)
    projected_at = serializers.DateTimeField(allow_null=True)
    attribution_required = serializers.BooleanField()


class RegisterCapitalIncreaseDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    snapshot = RegisterCapitalIncreaseSnapshotSerializer()
    intent_digest = serializers.CharField()
    approval_decision = serializers.UUIDField(allow_null=True)
    prior_authorized_total = serializers.CharField()
    additional_shares = serializers.CharField()
    new_authorized_total = serializers.CharField()


class RegisterCapitalIncreaseDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterCapitalIncreaseDecision


class RegisterCapitalIncreaseSerializer(RegisterDecidedSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    additional_shares = serializers.CharField(source="request.additional_shares", read_only=True)
    new_authorized_total = serializers.CharField(source="request.new_authorized_total", read_only=True)
    purpose = serializers.CharField(source="request.purpose", read_only=True)
    board_resolution_reference = serializers.CharField(source="request.board_resolution_reference", read_only=True)
    shareholder_approval_reference = serializers.CharField(
        source="request.shareholder_approval_reference", read_only=True
    )
    snapshot = RegisterCapitalIncreaseSnapshotSerializer(read_only=True)
    decisions = RegisterCapitalIncreaseDecisionSerializer(many=True, read_only=True)
    execution = serializers.SerializerMethodField()
    execution_unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = RegisterCapitalIncrease
        fields = [
            "uuid",
            "operation_id",
            "company",
            "token",
            "request",
            "additional_shares",
            "new_authorized_total",
            "purpose",
            "board_resolution_reference",
            "shareholder_approval_reference",
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

    @extend_schema_field(RegisterCapitalIncreaseExecutionSerializer(allow_null=True))
    def get_execution(self, obj):
        from tokens.services.register_capital_increases import execution_receipt

        receipt = execution_receipt(obj)
        return RegisterCapitalIncreaseExecutionSerializer(receipt).data if receipt is not None else None

    def get_execution_unmet_requirements(self, obj) -> list[str]:
        from tokens.services.register_capital_increases import execution_requirements

        return execution_requirements(obj)


class RegisterCapitalIncreaseDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterCapitalIncreaseDecideSerializer(RegisterDecideSerializer):
    pass
