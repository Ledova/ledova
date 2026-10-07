from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletInstructionDecision,
    CompanyWalletNomination,
    WhitelistAction,
    WhitelistChange,
)


class WalletNominationPreviewSerializer(serializers.Serializer):
    request = serializers.UUIDField()
    wallet = serializers.UUIDField()


class WalletNominationCreateSerializer(WalletNominationPreviewSerializer):
    operation_id = serializers.UUIDField()
    preview_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")
    sharing_accepted = serializers.BooleanField()


class WalletNominationPreviewResultSerializer(serializers.Serializer):
    request = serializers.UUIDField()
    decision = serializers.UUIDField(allow_null=True)
    company = serializers.UUIDField()
    wallet = serializers.UUIDField()
    address = serializers.CharField()
    chain = serializers.CharField()
    proof = serializers.UUIDField(allow_null=True)
    proof_completed_at = serializers.DateTimeField(allow_null=True)
    eligibility_expires_at = serializers.DateTimeField(allow_null=True)
    preview_digest = serializers.CharField()
    can_submit = serializers.BooleanField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())


class CompanyWalletNominationSerializer(serializers.ModelSerializer):
    address = serializers.CharField(source="snapshot.address", read_only=True)
    chain = serializers.CharField(source="snapshot.chain", read_only=True)
    proof_completed_at = serializers.DateTimeField(source="snapshot.proof_completed_at", read_only=True)
    eligibility_expires_at = serializers.DateTimeField(source="snapshot.eligibility_expires_at", read_only=True)
    unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = CompanyWalletNomination
        fields = [
            "uuid",
            "request",
            "decision",
            "company",
            "address",
            "chain",
            "proof_completed_at",
            "eligibility_expires_at",
            "digest",
            "submitted_at",
            "unmet_requirements",
        ]
        read_only_fields = fields

    def get_unmet_requirements(self, obj) -> list[str]:
        from whitelist.services.wallet_nominations import nomination_requirements

        return nomination_requirements(obj)


class WalletNominationSerializer(CompanyWalletNominationSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    wallet = serializers.UUIDField(source="wallet_id", read_only=True)

    class Meta(CompanyWalletNominationSerializer.Meta):
        fields = CompanyWalletNominationSerializer.Meta.fields + ["operation_id", "wallet", "proof", "sharing_accepted"]
        read_only_fields = fields


class CompanyWalletInstructionCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    company = serializers.UUIDField()
    action = serializers.ChoiceField(choices=WhitelistAction.choices)
    nomination = serializers.UUIDField(required=False, allow_null=True, default=None)
    target_change = serializers.UUIDField(required=False, allow_null=True, default=None)
    expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)


class CompanyWalletCompanySnapshotSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    acn = serializers.CharField()
    status = serializers.CharField()


class CompanyWalletTargetSnapshotSerializer(serializers.Serializer):
    address = serializers.CharField()
    chain = serializers.CharField()
    chain_id = serializers.IntegerField()
    registry_address = serializers.CharField()
    expires_at = serializers.DateTimeField(allow_null=True)


class CompanyWalletSourceSnapshotSerializer(serializers.Serializer):
    nomination = serializers.UUIDField(allow_null=True)
    request = serializers.UUIDField(allow_null=True)
    decision = serializers.UUIDField(allow_null=True)
    proof_completed_at = serializers.DateTimeField(allow_null=True)
    eligibility_expires_at = serializers.DateTimeField(allow_null=True)
    target_change = serializers.UUIDField(allow_null=True)


class CompanyWalletTransactionSnapshotSerializer(serializers.Serializer):
    chain_id = serializers.IntegerField()
    sender = serializers.CharField()
    to = serializers.CharField()
    value = serializers.CharField()
    data = serializers.CharField()


class CompanyWalletInstructionSnapshotSerializer(serializers.Serializer):
    company = CompanyWalletCompanySnapshotSerializer()
    target = CompanyWalletTargetSnapshotSerializer()
    source = CompanyWalletSourceSnapshotSerializer()
    transaction = CompanyWalletTransactionSnapshotSerializer()


class CompanyWalletInstructionExecutionSerializer(serializers.Serializer):
    change = serializers.UUIDField()
    status = serializers.CharField()
    operation_id = serializers.UUIDField(allow_null=True)
    claim_id = serializers.UUIDField(allow_null=True)
    operation_status = serializers.CharField(allow_null=True)
    tx_hash = serializers.CharField(allow_null=True)
    transaction = serializers.UUIDField(allow_null=True)
    block_number = serializers.IntegerField(allow_null=True)
    block_hash = serializers.CharField(allow_null=True)
    completed_at = serializers.DateTimeField(allow_null=True)
    failure_code = serializers.CharField(allow_blank=True)


class CompanyWalletInstructionDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    snapshot = CompanyWalletInstructionSnapshotSerializer()
    intent_digest = serializers.CharField()
    approval_decision = serializers.UUIDField(allow_null=True)
    change_id = serializers.UUIDField(allow_null=True)


class CompanyWalletInstructionDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = CompanyWalletInstructionDecision


class CompanyWalletInstructionSerializer(RegisterDecidedSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    snapshot = CompanyWalletInstructionSnapshotSerializer(read_only=True)
    decisions = CompanyWalletInstructionDecisionSerializer(many=True, read_only=True)
    execution = serializers.SerializerMethodField()
    execution_unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = CompanyWalletInstruction
        fields = [
            "uuid",
            "operation_id",
            "company",
            "action",
            "nomination",
            "target_change",
            "expires_at",
            "snapshot",
            "intent_digest",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "approval_decision",
            "change_id",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
            "execution",
            "execution_unmet_requirements",
        ]
        read_only_fields = fields

    @extend_schema_field(CompanyWalletInstructionExecutionSerializer(allow_null=True))
    def get_execution(self, obj):
        from whitelist.services.company_wallet_instructions import execution_receipt

        receipt = execution_receipt(obj)
        return CompanyWalletInstructionExecutionSerializer(receipt).data if receipt is not None else None

    def get_execution_unmet_requirements(self, obj) -> list[str]:
        from whitelist.services.company_wallet_instructions import (
            execution_requirements,
        )

        return execution_requirements(obj)


class CompanyWalletInstructionDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class CompanyWalletInstructionDecideSerializer(RegisterDecideSerializer):
    pass


class CompanyWalletTargetSerializer(serializers.ModelSerializer):
    company = serializers.UUIDField(source="company_id", read_only=True)

    class Meta:
        model = WhitelistChange
        fields = ["uuid", "company", "address", "chain_id", "registry_address", "expires_at", "status", "completed_at"]
        read_only_fields = fields
