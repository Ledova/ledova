from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import (
    RegisterCorrectionAuthority,
    RegisterMember,
    RegisterOpening,
    RegisterOpeningDecision,
    RegisterWalletLink,
    RegisterWalletLinkDecision,
)
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)
from tokens.services.register import member_identities
from tokens.services.register_openings import NOT_PROVEN, PROVEN, mapping_summary
from whitelist.models import HolderType


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


class RegisterOpeningHolderSerializer(serializers.Serializer):
    address = serializers.CharField()
    shares = serializers.CharField()
    member = serializers.CharField(allow_null=True)
    member_name = serializers.CharField(allow_null=True)
    member_exists = serializers.BooleanField()


class RegisterOpeningBoundarySerializer(serializers.Serializer):
    block_number = serializers.IntegerField()
    block_hash = serializers.CharField()
    date = serializers.DateField()
    holdings = RegisterOpeningHolderSerializer(many=True)


class RegisterOpeningBlockSerializer(serializers.Serializer):
    number = serializers.IntegerField()
    hash = serializers.CharField()
    date = serializers.DateField()


class RegisterOpeningHoldersSerializer(serializers.Serializer):
    block = RegisterOpeningBlockSerializer()
    holdings = RegisterOpeningHolderSerializer(many=True)


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
        known = list(
            RegisterMember.objects.filter(company_id=obj.company_id, pk__in=set(members.values())).values_list(
                "pk", flat=True
            )
        )
        names = (
            {str(member): identity.name or None for member, identity in member_identities(obj.token, known).items()}
            if known
            else {}
        )
        existing = {str(member) for member in known}
        return {
            "block_number": obj.boundary["block"]["number"],
            "block_hash": obj.boundary["block"]["hash"],
            "date": obj.boundary["block"]["date"],
            "holdings": [
                {
                    "address": row["address"],
                    "shares": row["shares"],
                    "member": members.get(row["address"].lower()),
                    "member_name": names.get(members.get(row["address"].lower())),
                    "member_exists": members.get(row["address"].lower()) in existing,
                }
                for row in obj.boundary["holdings"]
            ],
        }


class RegisterWalletLinkCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    company_id = serializers.UUIDField()
    authority_evidence = serializers.UUIDField()
    mapping = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()), allow_empty=False, max_length=10000
    )
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterWalletLinkDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterWalletLinkDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterWalletLinkMappingSerializer(serializers.Serializer):
    address = serializers.CharField()
    member = serializers.CharField()
    member_exists = serializers.BooleanField()


class RegisterWalletStatusSerializer(serializers.Serializer):
    wallet_proof = serializers.ChoiceField(choices=[(PROVEN, "Proven"), (NOT_PROVEN, "Not proven")], allow_null=True)
    holder_type = serializers.ChoiceField(choices=HolderType.choices, allow_null=True)
    holder_name = serializers.CharField(allow_null=True)


class RegisterWalletLinkPreviewSerializer(RegisterWalletStatusSerializer, RegisterWalletLinkMappingSerializer):
    pass


class RegisterWalletLinkDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    links = RegisterWalletLinkPreviewSerializer(many=True)


class RegisterWaitingWalletSerializer(RegisterWalletStatusSerializer):
    address = serializers.CharField()
    waiting = serializers.IntegerField()


class RegisterWaitingWalletsSerializer(serializers.Serializer):
    wallets = RegisterWaitingWalletSerializer(many=True)


class RegisterWaitingWalletsRequestSerializer(serializers.Serializer):
    company = serializers.UUIDField()


class RegisterWalletLinkDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterWalletLinkDecision


class RegisterWalletLinkSerializer(RegisterDecidedSerializer):
    decisions = RegisterWalletLinkDecisionSerializer(many=True, read_only=True)
    mapping_summary = serializers.SerializerMethodField()

    class Meta:
        model = RegisterWalletLink
        fields = [
            "uuid",
            "company",
            "mapping",
            "mapping_summary",
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
            "decisions",
            "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(RegisterWalletLinkMappingSerializer(many=True))
    def get_mapping_summary(self, obj):
        return mapping_summary(obj)
