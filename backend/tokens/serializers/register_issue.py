from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import RegisterInstruction, RegisterInstructionDecision
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)
from tokens.serializers.register_deployment import (
    RegisterDeploymentTransactionSnapshotSerializer,
)


class RegisterIssueCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token = serializers.UUIDField()
    member = serializers.UUIDField()
    nomination = serializers.UUIDField()
    wallet_approval = serializers.UUIDField()
    shares = serializers.DecimalField(max_digits=10, decimal_places=0, min_value=1, max_value=2147483647)
    approving_director = serializers.CharField(max_length=255)
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)
    terms_on = serializers.DateField()
    terms = serializers.CharField(max_length=1000)
    acceptance_required = serializers.BooleanField()
    authority_evidence = serializers.UUIDField()
    terms_evidence = serializers.UUIDField()
    acceptance_evidence = serializers.UUIDField(required=False, allow_null=True, default=None)


class RegisterIssueCompanySnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    acn = serializers.CharField()
    status = serializers.CharField()


class RegisterIssueTokenSnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    symbol = serializers.CharField()
    chain = serializers.CharField()
    contract_address = serializers.CharField()
    authorised_shares = serializers.CharField()


class RegisterIssueMemberSnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    residential_address = serializers.CharField()
    identity_source = serializers.CharField()
    address = serializers.CharField()


class RegisterIssueWalletSnapshotSerializer(serializers.Serializer):
    nomination = serializers.UUIDField()
    approval = serializers.UUIDField()
    address = serializers.CharField()
    registry_address = serializers.CharField()
    chain_id = serializers.IntegerField()
    expires_at = serializers.DateTimeField()
    proof_completed_at = serializers.DateTimeField()
    eligibility_expires_at = serializers.DateTimeField()


class RegisterIssueRegisterSnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    opening = serializers.UUIDField()
    sequence = serializers.IntegerField()
    head_hash = serializers.CharField()
    issued_supply = serializers.CharField()
    current_shares = serializers.CharField()


class RegisterIssueSnapshotSerializer(serializers.Serializer):
    company = RegisterIssueCompanySnapshotSerializer()
    token = RegisterIssueTokenSnapshotSerializer()
    member = RegisterIssueMemberSnapshotSerializer()
    wallet = RegisterIssueWalletSnapshotSerializer()
    register = RegisterIssueRegisterSnapshotSerializer()
    transaction = RegisterDeploymentTransactionSnapshotSerializer()


class RegisterIssueExecutionSerializer(serializers.Serializer):
    execution = serializers.UUIDField()
    status = serializers.CharField()
    request = serializers.UUIDField()
    dispatch_id = serializers.UUIDField()
    issuance = serializers.UUIDField(allow_null=True)
    operation_id = serializers.UUIDField(allow_null=True)
    claim_id = serializers.UUIDField(allow_null=True)
    operation_status = serializers.CharField(allow_null=True)
    transaction = serializers.UUIDField(allow_null=True)
    tx_hash = serializers.CharField(allow_null=True)
    block_number = serializers.IntegerField(allow_null=True)
    block_hash = serializers.CharField(allow_null=True)
    completed_at = serializers.DateTimeField(allow_null=True)
    register_entry = serializers.UUIDField(allow_null=True)
    effective_on = serializers.DateField(allow_null=True)


class RegisterIssueDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    snapshot = RegisterIssueSnapshotSerializer()
    intent_digest = serializers.CharField()
    approval_decision = serializers.UUIDField(allow_null=True)
    shares = serializers.CharField()
    terms_on = serializers.DateField()
    terms = serializers.CharField()
    acceptance_required = serializers.BooleanField()
    approving_director = serializers.CharField()
    authority_reference = serializers.CharField()
    reason = serializers.CharField()
    register_sequence = serializers.IntegerField()
    issued_supply = serializers.CharField()
    reserved_shares = serializers.CharField()
    authorised_supply = serializers.CharField()
    available_shares = serializers.CharField()
    after_issued_supply = serializers.CharField()
    current_shares = serializers.CharField()
    after_shares = serializers.CharField()


class RegisterIssueDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterInstructionDecision


class RegisterIssueSerializer(RegisterDecidedSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    shares = serializers.CharField(source="request.amount", read_only=True)
    snapshot = RegisterIssueSnapshotSerializer(read_only=True)
    decisions = RegisterIssueDecisionSerializer(many=True, read_only=True)
    execution = serializers.SerializerMethodField()
    execution_unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = RegisterInstruction
        fields = [
            "uuid",
            "operation_id",
            "company",
            "token",
            "member",
            "nomination",
            "wallet_approval",
            "request",
            "shares",
            "terms_on",
            "terms",
            "acceptance_required",
            "approving_director",
            "authority_reference",
            "reason",
            "authority_evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
            "terms_evidence",
            "terms_fingerprint",
            "terms_snapshot",
            "acceptance_evidence",
            "acceptance_fingerprint",
            "acceptance_snapshot",
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

    @extend_schema_field(RegisterIssueExecutionSerializer(allow_null=True))
    def get_execution(self, obj):
        from tokens.services.register_issues import execution_receipt

        receipt = execution_receipt(obj)
        return RegisterIssueExecutionSerializer(receipt).data if receipt is not None else None

    def get_execution_unmet_requirements(self, obj) -> list[str]:
        from tokens.services.register_issues import execution_requirements

        return execution_requirements(obj)


class RegisterIssueDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterIssueDecideSerializer(RegisterDecideSerializer):
    pass
