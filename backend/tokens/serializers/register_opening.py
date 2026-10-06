from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import (
    RegisterCorrectionAuthority,
    RegisterOpening,
    RegisterOpeningDecision,
    RegisterWalletLink,
)
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterOpeningCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token_id = serializers.UUIDField()
    authority_evidence = serializers.UUIDField()
    mapping = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()), allow_empty=True, max_length=10000
    )
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterOpeningDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterOpeningDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterOpeningChangeSerializer(serializers.Serializer):
    member = serializers.CharField()
    shares = serializers.CharField()


class RegisterOpeningDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    changes = RegisterOpeningChangeSerializer(many=True)
    effective_on = serializers.DateField(allow_null=True)


class RegisterOpeningHoldingSerializer(serializers.Serializer):
    address = serializers.CharField()
    shares = serializers.CharField()
    member = serializers.CharField(allow_null=True)


class RegisterOpeningBoundarySerializer(serializers.Serializer):
    block_number = serializers.IntegerField()
    block_hash = serializers.CharField()
    date = serializers.DateField()
    holdings = RegisterOpeningHoldingSerializer(many=True)


class RegisterOpeningDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterOpeningDecision


class RegisterOpeningSerializer(RegisterDecidedSerializer):
    decisions = RegisterOpeningDecisionSerializer(many=True, read_only=True)
    boundary_summary = serializers.SerializerMethodField()

    class Meta:
        model = RegisterOpening
        fields = [
            "uuid",
            "company",
            "token",
            "mapping",
            "boundary",
            "boundary_summary",
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

    @extend_schema_field(RegisterOpeningBoundarySerializer(allow_null=True))
    def get_boundary_summary(self, obj):
        if obj.boundary is None:
            return None
        members = {link["address"].lower(): link["member"] for link in obj.mapping}
        return {
            "block_number": obj.boundary["block"]["number"],
            "block_hash": obj.boundary["block"]["hash"],
            "date": obj.boundary["block"]["date"],
            "holdings": [
                {"address": row["address"], "shares": row["shares"], "member": members.get(row["address"].lower())}
                for row in obj.boundary["holdings"]
            ],
        }


class RegisterWalletLinkCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    company_id = serializers.UUIDField()
    document_id = serializers.UUIDField()
    mapping = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()), allow_empty=False, max_length=10000
    )
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterWalletLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterWalletLink
        fields = [
            "uuid",
            "company",
            "mapping",
            "authority",
            "approving_director",
            "authority_reference",
            "reason",
            "source_document",
            "evidence_fingerprint",
            "evidence_snapshot",
            "submitted_by",
            "status",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "created_at",
        ]
        read_only_fields = fields
