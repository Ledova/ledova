from datetime import date

from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import RegisterGrant, RegisterGrantDecision
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterGrantCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token_id = serializers.UUIDField()
    member = serializers.UUIDField()
    new_member = serializers.BooleanField()
    name = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    residential_address = serializers.CharField(
        max_length=REGISTER_IMPORT_ADDRESS_LENGTH, allow_blank=True, required=False, default=""
    )
    shares = serializers.RegexField(regex=r"^[1-9][0-9]{0,77}$")
    terms_on = serializers.DateField()
    approving_director = serializers.CharField(max_length=255)
    terms = serializers.CharField(max_length=1000)
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)
    authority_evidence = serializers.UUIDField()
    terms_evidence = serializers.UUIDField()
    acceptance_required = serializers.BooleanField()
    acceptance_evidence = serializers.UUIDField(allow_null=True, required=False, default=None)


class RegisterGrantDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterGrantDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterGrantDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    member = serializers.UUIDField()
    new_member = serializers.BooleanField()
    name = serializers.CharField()
    residential_address = serializers.CharField()
    shares = serializers.CharField()
    effective_on = serializers.DateField()
    terms_on = serializers.DateField()
    approving_director = serializers.CharField()
    terms = serializers.CharField()
    acceptance_required = serializers.BooleanField()
    register_sequence = serializers.IntegerField()
    issued_supply = serializers.CharField()
    authorised_supply = serializers.CharField()
    after_issued_supply = serializers.CharField()
    current_shares = serializers.CharField()
    after_shares = serializers.CharField()


class RegisterGrantDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterGrantDecision


class RegisterGrantSerializer(RegisterDecidedSerializer):
    effective_on = serializers.SerializerMethodField()
    decisions = RegisterGrantDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = RegisterGrant
        fields = [
            "uuid",
            "company",
            "token",
            "member",
            "new_member",
            "name",
            "residential_address",
            "shares",
            "effective_on",
            "terms_on",
            "approving_director",
            "terms",
            "acceptance_required",
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
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "register_entry",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
        ]
        read_only_fields = fields

    def get_effective_on(self, obj) -> date | None:
        return obj.register_entry.effective_on if obj.register_entry_id else None
