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
from tokens.serializers.register_issue import (
    RegisterIssueCompanySnapshotSerializer,
    RegisterIssueExecutionSerializer,
    RegisterIssueTokenSnapshotSerializer,
)


class RegisterPaidIssueCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    subscription = serializers.UUIDField()
    approving_director = serializers.CharField(max_length=255)
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)
    authority_evidence = serializers.UUIDField()


class RegisterPaidIssueSourceSerializer(serializers.Serializer):
    subscription = serializers.UUIDField()
    offering = serializers.UUIDField()
    company = serializers.UUIDField()
    token = serializers.UUIDField()
    recipient_address = serializers.CharField()
    recipient_name = serializers.CharField(allow_blank=True)
    shares = serializers.CharField()
    requested_shares = serializers.CharField()
    currency = serializers.CharField()
    price_per_share = serializers.CharField()
    amount_due = serializers.CharField()
    amount_received = serializers.CharField(allow_null=True)
    money_held = serializers.CharField()
    payment_received_on = serializers.DateField(allow_null=True)
    payment_reference_seen = serializers.CharField(allow_blank=True)
    payment_tx_hash = serializers.CharField(allow_null=True, allow_blank=True)
    payment_confirmed_at = serializers.DateTimeField(allow_null=True)
    refund_amount = serializers.CharField(allow_null=True)
    refunded_at = serializers.DateTimeField(allow_null=True)


class RegisterPaidIssueRegisterSnapshotSerializer(serializers.Serializer):
    present = serializers.BooleanField()
    uuid = serializers.UUIDField(allow_null=True)
    sequence = serializers.IntegerField(allow_null=True)
    head_hash = serializers.CharField(allow_null=True)
    issued_supply = serializers.CharField(allow_null=True)


class RegisterPaidIssueSnapshotSerializer(serializers.Serializer):
    company = RegisterIssueCompanySnapshotSerializer()
    token = RegisterIssueTokenSnapshotSerializer()
    source = RegisterPaidIssueSourceSerializer()
    register = RegisterPaidIssueRegisterSnapshotSerializer()
    transaction = RegisterDeploymentTransactionSnapshotSerializer()


class RegisterPaidIssueDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    snapshot = RegisterPaidIssueSnapshotSerializer()
    intent_digest = serializers.CharField()
    approval_decision = serializers.UUIDField(allow_null=True)
    shares = serializers.CharField()
    approving_director = serializers.CharField()
    authority_reference = serializers.CharField()
    reason = serializers.CharField()
    offering_headroom = serializers.CharField()
    issued_supply = serializers.CharField()
    reserved_shares = serializers.CharField()
    authorised_supply = serializers.CharField()
    available_shares = serializers.CharField()


class RegisterPaidIssueDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterInstructionDecision


class RegisterPaidIssueSerializer(RegisterDecidedSerializer):
    operation_id = serializers.UUIDField(source="uuid", read_only=True)
    subscription = serializers.UUIDField(source="paid_subscription_id", read_only=True)
    subscription_status = serializers.CharField(source="paid_subscription.status", read_only=True)
    allotted_at = serializers.DateTimeField(source="paid_subscription.allotted_at", read_only=True, allow_null=True)
    shares = serializers.CharField(source="snapshot.source.shares", read_only=True)
    snapshot = RegisterPaidIssueSnapshotSerializer(read_only=True)
    decisions = RegisterPaidIssueDecisionSerializer(many=True, read_only=True)
    execution = serializers.SerializerMethodField()
    execution_unmet_requirements = serializers.SerializerMethodField()

    class Meta:
        model = RegisterInstruction
        fields = [
            "uuid",
            "operation_id",
            "company",
            "token",
            "subscription",
            "subscription_status",
            "allotted_at",
            "request",
            "shares",
            "approving_director",
            "authority_reference",
            "reason",
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

    @extend_schema_field(RegisterIssueExecutionSerializer(allow_null=True))
    def get_execution(self, obj):
        from tokens.services.register_issues import execution_receipt

        receipt = execution_receipt(obj) if obj.request_id else None
        return RegisterIssueExecutionSerializer(receipt).data if receipt is not None else None

    def get_execution_unmet_requirements(self, obj) -> list[str]:
        from tokens.services.register_paid_issues import execution_requirements

        return execution_requirements(obj)


class RegisterPaidIssueDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterPaidIssueDecideSerializer(RegisterDecideSerializer):
    pass
